/*
 * Created: 7 May 2015 Vincent Guo <vg@mega.co.nz>
 *
 * (c) 2015 by Mega Limited, Auckland, New Zealand
 *     http://mega.co.nz/
 *
 * This file is part of the multi-party chat encryption suite.
 *
 * This code is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License version 3
 * as published by the Free Software Foundation. See the accompanying
 * LICENSE file or <https://www.gnu.org/licenses/> if it is unavailable.
 *
 * This code is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 */

define([
    "mpenc/session",
    "mpenc/channel",
    "mpenc/liveness",
    "mpenc/message",
    "mpenc/transcript",
    "mpenc/impl/liveness",
    "mpenc/impl/transcript",
    "mpenc/impl/serverorder",
    "mpenc/helper/assert",
    "mpenc/helper/struct",
    "mpenc/helper/async",
    "mpenc/helper/utils",
    "megalogger"
], function(session, channel, liveness, message, transcript,
    livenessImpl, transcriptImpl, serverorder,
    assert, struct, async, utils, MegaLogger) {
    "use strict";

    /**
     * @exports mpenc/impl/session
     * @description
     * Session related operations
     */
    var ns = {};

    var logger = MegaLogger.getLogger("session");
    var _assert = assert.assert;

    // import events
    var MsgAccepted   = transcript.MsgAccepted;
    var NotAccepted   = liveness.NotAccepted;
    var MsgFullyAcked = transcript.MsgFullyAcked;
    var NotFullyAcked = liveness.NotFullyAcked;
    var SNStateChange = session.SNStateChange;
    var SessionState = session.SessionState;
    var SNMembers = session.SNMembers;
    var NotDecrypted = session.NotDecrypted;

    // import components
    var Session = session.Session;
    var Flow = liveness.Flow;
    var BaseTranscript = transcriptImpl.BaseTranscript;
    var DefaultConsistencyMonitor = livenessImpl.DefaultConsistencyMonitor;
    var ServerOrder = serverorder.ServerOrder;

    // import message-types
    var Message = message.Message;
    var Payload = message.Payload;
    var ExplicitAck = message.ExplicitAck;
    var Consistency = message.Consistency;

    // import utils
    var Observable = async.Observable;
    var Subscribe = async.Subscribe;
    var EventContext = async.EventContext;
    var ImmutableSet = struct.ImmutableSet;
    var TrialTimeoutTarget = struct.TrialTimeoutTarget;
    var TrialBuffer = struct.TrialBuffer;
    var StateMachine = utils.StateMachine;


    /**
     * Context of a session.
     *
     * @class
     * @memberOf module:mpenc/impl/session
     */
    var SessionContext = struct.createTupleClass("owner", "keepfresh", "timer", "flowctl", "codec", "makeMessageLog");

    Object.freeze(SessionContext.prototype);
    ns.SessionContext = SessionContext;


    /**
     * Implementation of roughly the lower (transport-facing) part of Session.
     *
     * <p>Manages operations on the causally-ordered transcript data structure,
     * flow control algorithms, message security, consistency checking, etc.</p>
     *
     * The instantiated types for <code>SendingReceiver</code> are:
     *
     * <ul>
     * <li><code>{@link module:mpenc/impl/session.SessionBase#recv|RecvInput}</code>:
     *      {@link module:mpenc/helper/utils~RawRecv}</li>
     * <li><code>{@link module:mpenc/impl/session.SessionBase#onSend|SendOutput}</code>:
     *      {@link module:mpenc/helper/utils~RawSend}</li>
     * </ul>
     *
     * @class
     * @memberOf module:mpenc/impl/session
     * @implements {module:mpenc/liveness.Flow}
     * @implements {module:mpenc/helper/async.EventSource}
     * @implements {module:mpenc/helper/utils.SendingReceiver}
     * @param context {module:mpenc/impl/session.SessionContext} Session context.
     * @param sId {string} Session id, shared between all members.
     * @param members {module:mpenc/helper/struct.ImmutableSet} Set of members.
     * @param msgsec {module:mpenc/message.MessageSecurity} Security component.
     * @see module:mpenc/session.Session
     */
    var SessionBase = function(context, sId, members, msgsec) {
        this.options = {
            /**
             * Ratio of heartbeat interval to the full-ack-interval
             * How long to wait when we are idle, before sending a heartbeat.
             */
            HEARTBEAT_RATIO : 4,

            /**
             * Ratio of fin consistency timeout to the broadcast-latency
             * How long to wait for consistency, before we publish that fin() completed with inconsistency.
             */
            FIN_TIMEOUT_RATIO : 16,

            /**
             * Ratio of fin consistency grace-wait to the broadcast-latency
             * How long to wait after consistency is reached, before we publish that fin() completed with consistency.
             */
            FIN_CONSISTENT_RATIO : 1,

            /**
             * Give others a little bit longer than ourselves to expire freshness.
             */
            EXPIRE_GRACE_RATIO : 1.0625
        };

        this._stateMachine = new StateMachine(SNStateChange, SessionState.JOINED);
        this._events = new EventContext(SessionBase.EventTypes);

        this._owner = context.owner;
        this._sId = sId;
        this._transcript = new BaseTranscript();
        this._roTranscript = Object.create(this._transcript, { add: {} });

        this._timer = context.timer;
        this._ctime = new Map();
        this._ktime = new Map();

        this._send = new async.Observable(true);
        var cancels = [];

        this._members = members;
        this._msgsec = msgsec;

        var self = this;
        this._flowctl = context.flowctl;
        this._consistency = new DefaultConsistencyMonitor(
            context.owner, context.timer,
            this._onFullAck.bind(this),
            this._fullAckInterval.bind(this),
            function(mId) { self._events.publish(new NotFullyAcked(mId)); },
            this.needAckmon.bind(this),
            this._transcript.unackby.bind(this._transcript),
            this._generateMonitorIntervals.bind(this),
            function() {},
            this._handleUnackedByOwn.bind(this));

        this._codec = context.codec;
        var tryAccept = new TrialTimeoutTarget(
            context.timer, this._broadcastLatency(),
            this._tryAcceptTimeout.bind(this),
            {
                maxSize: this._expectedMaxBuf.bind(this),
                paramId: function(param) { return utils.sha256(param[1]); },
                tryMe: this._tryAcceptTry.bind(this),
                cleanup: this._tryAcceptCleanup.bind(this),
            });
        this._tryAccept = new TrialBuffer('try-accept for ' + this._sId, tryAccept);

        this._fin = new Observable();
        this._pubtxt = new Map(); /* ciphertxt cache, mId->pubtxt and pubtxt->mId*/

        this._cancels = async.combinedCancel(cancels);
    };

    SessionBase.EventTypes = [SNStateChange, MsgAccepted, MsgFullyAcked, NotAccepted, NotFullyAcked];

    SessionBase.prototype._expectedMaxBuf = function() {
        return 4 * Math.max(16, Math.sqrt(this.curMembers().size) * 8);
    };

    SessionBase.prototype._onlyWhileJoined = function(body) {
        return (body instanceof Payload || Consistency.isFin(body));
    };

    SessionBase.prototype._broadcastLatency = function(r) {
        r = r || 1;
        return r * this._flowctl.getBroadcastLatency();
    };

    SessionBase.prototype._fullAckInterval = function(mId, r) {
        r = r || 1;
        return r * this._flowctl.getFullAckInterval(this, mId);
    };

    SessionBase.prototype._onFullAck = function(mId) {
        var sub_evt = this._events.subscribe(MsgFullyAcked, [mId]);
        return Subscribe.wrap(function(sub) {
            return sub_evt(function(evt) { return sub(evt.mId); });
        });
    };

    // This will eventually be part of a FlowControl interface/implementation
    SessionBase.prototype._generateMonitorIntervals = function(mId) {
        return struct.toIterator(
            this.owns(mId) ? [] : [this._fullAckInterval(mId) - this._broadcastLatency()]);
    };

    // This will eventually be part of a FlowControl interface/implementation
    SessionBase.prototype._handleUnackedByOwn = function(mId) {
        _assert(!this.owns(mId) && this.transcript().suc_ruId(mId, this.owner()) === null);
        _assert(this.transcript().has(mId));
        var sent = this.sendObject(new ExplicitAck(false));
        _assert(sent && this.transcript().suc_ruId(mId, this.owner()) !== null);
    };

    // In the python, these form part of the Membership interface, which is
    // not currently needed in this library since we use HybridSession exclusively
    SessionBase.prototype._membersAfter = function(transcript, parents) {
        return this._members;
    };

    // In the python, these form part of the Membership interface, which is
    // not currently needed in this library since we use HybridSession exclusively
    SessionBase.prototype._membersChangedBy = function(transcript, membersBefore, msg) {
        _assert(membersBefore.equals(this._members),
            'members is not equal to members before');
        if (!membersBefore.equals(msg.members())) {
            throw new Error("msg has unexpected members: expected " + membersBefore +
                            ", actual " + msg.members());
        }
        return ImmutableSet.EMPTY_DIFF;
    };

    // "implements" StateMachine

    /**
     * Get the current state.
     * @returns {SessionState}
     */
    SessionBase.prototype.state = function() {
        return this._stateMachine.state();
    };

    SessionBase.prototype._setState = function(newState) {
        // set the state of the internal FSM, and return a transition event
        // object to be published to our subscribers
        var chg = this._stateMachine.setState(newState);
        this._events.publish(chg);
        return chg;
    };

    // implements EventSource

    /**
     * @method
     * @inheritDoc
     */
    SessionBase.prototype.onEvent = function(evtcls, prefix, useCapture) {
        return this._events.subscribe(evtcls, prefix, useCapture);
    };

    // implements Flow

    /**
     * @method
     * @inheritDoc
     */
    SessionBase.prototype.owner = function()  {
        return this._owner;
    };

    /**
     * @method
     * @inheritDoc
     */
    SessionBase.prototype.transcript = function() {
        return this._roTranscript;
    };

    /**
     * @method
     * @inheritDoc
     */
    SessionBase.prototype.curMembers = function() {
        return this._membersAfter(this._transcript, this._transcript.max());
    };

    /**
     * @method
     * @inheritDoc
     */
    SessionBase.prototype.ctime = function(mId) {
        return struct.safeGet(this._ctime, mId);
    };

    /**
     * @method
     * @inheritDoc
     */
    SessionBase.prototype.ktime = function(mId) {
        return struct.safeGet(this._ktime, mId);
    };

    /**
     * @method
     * @inheritDoc
     */
    SessionBase.prototype.needAckmon = function(mId) {
        return !(this._transcript.get(mId).body instanceof ExplicitAck);
    };

    /**
     * @method
     * @inheritDoc
     */
    SessionBase.prototype.owns = Flow.prototype.owns;

    /**
     * @method
     * @inheritDoc
     */
    SessionBase.prototype.lastOwnMsg = Flow.prototype.lastOwnMsg;

    // implements SendingReceiver; also helps to implement Session

    /**
     * @returns {string} Session Id.
     */
    SessionBase.prototype.sId = function() {
        return this._sId;
    };

    /**
     * Returns whether our session transcript is consistent with ours.
     * @returns {boolean}
     */
    SessionBase.prototype.isConsistent = function() {
        var self = this;
        return !this._transcript.unacked().some(function(mId) {
            return self._transcript.get(mId).body instanceof Payload;
        });
    };

    /**
     * Send application-level data.
     *
     * @param contents {?string}
     * @returns {boolean} Whether the contents were accepted to be sent.
     */
    SessionBase.prototype.sendData = function(contents) {
        // TODO(xl): [F] if we "recently" (e.g. <1s ago) accepted a message, the
        // user is unlikely to have fully-understood it. so perhaps we should
        // actually only point to non-recent messages as the "parent" messages.
        return this.sendObject((contents) ? new Payload(contents) : new ExplicitAck(true));
    };

    /**
     * @method
     * @inheritDoc
     */
    SessionBase.prototype.sendObject = function(body) {
        if ((this._stateMachine.state() !== SessionState.JOINED) &&
             this._onlyWhileJoined(body)) {
            return false;
        }
        var ts = this.transcript();
        var author = this.owner();
        var parents = ts.max();
        var recipients = this.curMembers().subtract(new ImmutableSet([author]));

        // function(body, recipients, parents, paddingSize)
        var sectxt = this._codec.encode(body);
        var enc = this._msgsec.authEncrypt(ts, author, parents, recipients, sectxt);
        var pubtxt = enc[0], secret = enc[1];

        var mId = secret.mId;
        var msg = new Message(mId, author, parents, recipients, body);
        try {
            this._add(msg, pubtxt);
            secret.commit();
        } catch (e) {
            secret.destroy();
            this._handleInvalidMessage(mId, author, parents, recipients, e);
            return false;
        }

        var stat = this._send.publish({ pubtxt: pubtxt, recipients: recipients });
        return stat.some(Boolean);
    };

    /**
     * @inheritDoc
     */
    SessionBase.prototype.recv = function(recv_in) {
        var pubtxt = recv_in.pubtxt;
        var sender = recv_in.sender;
        var mId = this._pubtxt.get(pubtxt);
        if (mId) {
            // duplicate received
            return true;
        }
        try {
            var dec = this._msgsec.decryptVerify(this._transcript, pubtxt, sender);
            var author = dec[0], parents = dec[1], recipients = dec[2],
                sectxt = dec[3], secret = dec[4];
            mId = secret.mId;
        } catch (e) {
            return false;
        }
        _assert(author !== this.owner(), 'received non-duplicate message from owner');

        try {
            var body = this._codec.decode(sectxt);
        } catch (e) {
            secret.destroy();
            this._handleInvalidMessage(mId, author, parents, recipients, e);
            return true; // decrypt succeeded so message was indeed properly part of the session
        }

        var msg = new Message(mId, author, parents, recipients, body);
        this._tryAccept.trial([msg, pubtxt, secret]);
        return true;
    };

    /**
     * @inheritDoc
     */
    SessionBase.prototype.onSend = function(send_out) {
        return this._send.subscribe(send_out);
    };

    SessionBase.prototype._handleInvalidMessage = function(mId, author, parents, recipients, error) {
        // TODO(xl): [D/F] more specific handling of:
        // - message decode error
        // - total-order breaking
        // - transitive-reduction breaking
        // - bad membership change
        // TODO(xl): [F] (invalid-msg) also should emit error message and shutdown the session
        logger.warn('BAD MESSAGE (malicious/buggy peer?) in verified-decrypted msg ' +
            mId + ' : ' + error);
    };

    SessionBase.prototype._tryAcceptCleanup = function(replace, param) {
        var secret = param[2];
        if (!replace) {
            secret.destroy();
        }
    };

    SessionBase.prototype._tryAcceptTimeout = function(param) {
        var msg = param[0], pubtxt = param[1];
        this._events.publish(new NotAccepted(msg.author, msg.parents));
    };

    SessionBase.prototype._tryAcceptTry = function(_, param) {
        var msg = param[0], pubtxt = param[1], secret = param[2];

        // a slight hack, works because Transcript implements "has" which subtract needs
        var diff = msg.parents.subtract(this._transcript);
        if (diff.size > 0) {
            // parents not yet all received
            return false;
        }

        try {
            var mId = msg.mId;
            this._add(msg, pubtxt);
            secret.commit();
            return true;
        } catch (e) {
            secret.destroy();
            this._handleInvalidMessage(msg.mId, msg.author, msg.parents, msg.recipients, e);
            return true; // message was accepted as invalid, don't buffer again
        }
    };

    SessionBase.prototype._add = function(msg, pubtxt) {
        var self = this;
        var ts = this.transcript();
        var membersBefore = this._membersAfter(ts, msg.parents);
        var intendedDiff = this._membersChangedBy(ts, membersBefore, msg);

        var fullAcked = this._transcript.add(msg);
        // from this point onwards, should be no exceptions raised

        var mId = msg.mId;
        var tick = this._timer.now();

        this._pubtxt.set(pubtxt, mId);
        this._pubtxt.set(mId, pubtxt);
        this._ctime.set(mId, tick);
        this._ktime.set(mId, null);
        for (var i = 0; i < fullAcked.length; i++) {
            this._ktime.set(fullAcked[i], tick);
        }

        this._consistency.expect(mId);
        this._events.subscribe(MsgFullyAcked, [mId])(function(evt) {
            var mId = evt.mId;
            self._pubtxt.delete(mId);
            // this._pubtxt.delete(pubtxt);
            // TODO(xl): this is hard to get right; see python for ideas
        });

        this._events.publish(new MsgAccepted(mId));
        for (var i = 0; i < fullAcked.length; i++) {
            this._events.publish(new MsgFullyAcked(fullAcked[i]));
        }
    };

    // other own public methods

    /**
     * Send a close message, delegating to send(). Stop any heartbeats, and
     * wait for consistency to be reached. When this is reached or times out,
     * sub_fin() subscribers will be notified.
     *
     * No Payload may be sent after this is called.
     *
     * @returns {boolean} whether this operation was appropriate at this time
     */
    SessionBase.prototype.fin = StateMachine.transition(
        [SessionState.JOINED],
        [SessionState.JOINED, SessionState.PARTING], function() {

        if (!this.sendObject(new Consistency(true))) {
            return false;
        }

        // TODO(xl): [D/F] if transcript is empty, perhaps make this a no-op
        var ts = this.transcript();
        _assert(ts.max().size === 1);
        var mId = ts.max().toArray()[0];
        this._setState(SessionState.PARTING);

        var self = this;
        var _pubFin = function() {
            self.stop();
            self._fin.publish(mId);
            if (self.isConsistent()) {
                self._setState(SessionState.PARTED);
            } else {
                self._setState(SessionState.PART_FAILED);
            }
        };
        var finTimeout = this._broadcastLatency(this.options.FIN_TIMEOUT_RATIO);
        var finConsistent = this._broadcastLatency(this.options.FIN_CONSISTENT_RATIO);
        this._events.subscribe(MsgFullyAcked, [mId]).withBackup(
            this._timer.after(finTimeout), _pubFin)(function(evt) {
            self._timer.after(finConsistent, _pubFin);
        });

        return true;
    });

    /**
     * Subscribe to notices that fin() reached consistency or timed out.
     *
     * Note: subscriptions are fired *before* any state() changes.
     */
    SessionBase.prototype.onFin = function(sub) {
        return this._fin.subscribe(sub);
    };

    /**
     * Stop running monitors, close resources, cancel subscriptions.
     */
    SessionBase.prototype.stop = function() {
        var ts = this.transcript();
        _assert(new ImmutableSet(this._consistency.active()).equals(
                new ImmutableSet(ts.unacked())), 'unmatched keys');
        this._consistency.stop();
        this._cancels();
    };

    /**
     * Update the presence of a user, based on a MsgAccepted event.
     * @param {type} presence
     * @param {type} evt
     */
    SessionBase.prototype.updateFreshness = function(presence, evt) {
        var mId = evt.mId;
        var msg = this._transcript.get(mId);
        var uId = msg.author;
        var own = (uId === this.owner());
        // last own message that this message was sent after
        var lastOwn = own ? mId : this._transcript.pre_ruId(mId, this.owner());
        // TODO(xl): [F/D] need some other mechanism to determine known_ts if there is no own last message
        var knownTs = lastOwn ? this.ctime.get(lastOwn) : 0;
        var expireAfter = this._fullAckInterval(mId, this.options.HEARTBEAT_RATIO);
        presence.renew(uId, knownTs,
                       own ? expireAfter : expireAfter * this.options.EXPIRE_GRACE_RATIO);
        // if message is Consistency(close=True) then set UserAbsent(intend=True) on full-ack
        if (Consistency.isFin(msg.body)) {
            this._events.subscribe(MsgFullyAcked, [mId])(function() {
                presence.absent(uId, knownTs);
            });
        }
    };

    /**
     * Ticks after which we should assume others expire our own presence.
     */
    SessionBase.prototype.ownExpiry = function() {
        return this._fullAckInterval(this.lastOwnMsg(), this.options.HEARTBEAT_RATIO);
    };

    /**
     * Fire user-relevant events from here into an actual Session.
     */
    SessionBase.prototype.chainUserEventsTo = function(sess, evtctx) {
        var special = new ImmutableSet([MsgAccepted, NotFullyAcked, MsgFullyAcked]);
        var evtcls = this._events.evtcls().subtract(special);
        var cancel_else = evtctx.chainFrom(this._events, evtcls);

        // - ignore MsgAccepted; assume something else is already firing MsgReady
        // - forward *all* NotAccepted, since they might indicate missing Payload messages
        // - forward NotFullyAcked / MsgFullyAcked only for Payload messages

        var cancel_onNotFullyAcked = this._events.subscribe(NotFullyAcked)(function(evt) {
            if (sess.messages().has(evt.mId)) {
                evtctx.publish(evt);
            }
        });

        var cancel_onMsgFullyAcked = this._events.subscribe(MsgFullyAcked)(function(evt) {
            if (sess.messages().has(evt.mId)) {
                evtctx.publish(evt);
            }
        });

        return async.combinedCancel([
            cancel_else, cancel_onNotFullyAcked, cancel_onMsgFullyAcked]);
    };

    ns.SessionBase = SessionBase;


    /**
     * A Session with a linear order on its membership operations.
     *
     * @class
     * @memberOf module:mpenc/impl/session
     * @implements {module:mpenc/session.Session}
     * @param context {module:mpenc/impl/session.SessionContext} Session context.
     * @param sId {string} Session id, shared between all members.
     * @param channel {module:mpenc/channel.GroupChannel} Group transport channel.
     * @param greeter {module:mpenc/greet/greeter.Greeter} Membership operation component.
     * @param makeMessageSecurity {function} 1-arg factory function for a
     *      {@link module:mpenc/message.MessageSecurity}.
     */
    var HybridSession = function(context, sId, channel, greeter, makeMessageSecurity) {
        this._context = context;
        this._events = new EventContext(Session.EventTypes);

        this._owner = context.owner;
        this._ownSet = new ImmutableSet([this._owner]);
        this._sId = sId;
        this._channel = channel;

        this._timer = context.timer;
        var cancels = [];

        this._flowctl = context.flowctl;

        this._messages = context.makeMessageLog();
        cancels.push(this._messages.bindTarget(this._events));

        this._greeter = greeter;
        this._makeMessageSecurity = makeMessageSecurity;

        // sub-sessions
        this._curSession = null;
        this._curSessionCancel = null;
        this._curGreetState = null;
        this._prevSession = null;
        this._prevSessionCancel = null;
        this._prevGreetState = null;
        this._droppedInconsistentSession = false;

        // sub-session send/recv logic
        cancels.push(this._channel.onRecv(this._recv.bind(this)));
        this._sessionRecv = new Observable(); // for sub-sessions to listen on, filters out greeting packets
        var tryDecrypt = new TrialTimeoutTarget(
            this._timer, this._flowctl.getBroadcastLatency(),
            this._tryDecryptTimeout.bind(this),
            {
                maxSize: this._flowctl.asynchronity.bind(this._flowctl, this),
                paramId: function(recv_in) { return utils.sha256(recv_in.pubtxt); },
                tryMe: this._tryDecryptTry.bind(this)
            });
        this._tryDecrypt = new TrialBuffer('try-decrypt for ' + this.sId, tryDecrypt);

        // global ops
        this._serverOrder = new ServerOrder();
        this._greeting = null;
        this._clearChannelRecords();
        this._greetingCancel = function() {};
        this._clearGreeting();

        this._clearOwnProposal();
        this._clearOwnOperation();

        this._cancel = async.combinedCancel(cancels);
    };

    HybridSession.prototype._clearChannelRecords = function(r) {
        this._serverOrder.clear();
        this._taskExclude = new Set();
        this._taskLeave = new Set();
        return async.exitFinally(r);
    };

    HybridSession.prototype._clearGreeting = function(r) {
        this._greetingCancel();
        this._greetingCancel = null;
        this._greeting = null;
        if (r instanceof Error && typeof r.message === "string" &&
            r.message.indexOf("OperationIgnored:") === 0) {
            logger.info(r.message);
            return null;
        }
        return async.exitFinally(r);
    };

    HybridSession.prototype._setGreeting = function(greeting) {
        this._greeting = greeting;
        this._greetingCancel = greeting.onSend(this._channel.send.bind(this._channel));
        var p = greeting.getPromise();
        var clear = this._clearGreeting.bind(this);
        p.then(this._onGreetingComplete.bind(this))
         .then(this._changeSubSession.bind(this))
         .then(clear, clear)
         .catch(logger.warn.bind(logger));
        // greeting accepted, try to achieve consistency in case this succeeds
        // and we need to rotate the sub-session
        if (this._curSession && this._curSession.state() === SessionState.JOINED) {
            this._curSession.sendObject(new Consistency(false));
        }
    };

    HybridSession.prototype._clearOwnOperation = function(r) {
        this._ownOperationPr = null;
        this._ownOperationParam = null;
        return async.exitFinally(r);
    };

    HybridSession.prototype._setOwnOperation = function(promise, opParam) {
        this._ownOperationPr = promise;
        this._ownOperationParam = opParam;
        var clear = this._clearOwnOperation.bind(this);
        promise.then(clear, clear).catch(logger.warn.bind(logger));
    };

    HybridSession.prototype._clearOwnProposal = function(r) {
        this._ownProposalPr = null;
        this._ownProposalPrev = null;
        this._ownProposalHash = null;
        return async.exitFinally(r);
    };

    HybridSession.prototype._setOwnProposal = function(prev, pHash) {
        var p = async.newPromiseAndWriters();
        this._ownProposalPr = p;
        this._ownProposalPrev = prev;
        this._ownProposalHash = pHash;
        var clear = this._clearOwnProposal.bind(this);
        p.promise.then(clear, clear).catch(logger.warn.bind(logger));
        return p.promise;
    };

    // Execute necessary book-keeping tasks

    HybridSession.prototype._maybeFinishOwnProposal = function(pHash, inPid, inPrevPid, greeting) {
        if (pHash === this._ownProposalHash) {
            _assert(this._ownProposalPrev === inPrevPid);
            this._ownProposalPr.resolve(greeting);
        } else if (this._ownProposalPrev === inPrevPid) {
            this._ownProposalPr.reject(new Error("ProposalRejected: " + inPid));
        }
    };

    HybridSession.prototype._maybeSyncNew = function(members) {
        _assert(this._channel.curMembers() !== null);
        if (this._channel.curMembers().size === 1) {
            this._serverOrder.syncNew();
        }
        // if someone invites us to a channel, just wait for them to include us
        // TODO(xl): [F] (parallel-op) this may not be the best thing to do; need more data to decide
    };

    HybridSession.prototype._maybeHandleTasks = function() {
        this._assertConsistentTasks();

        if (this._ownOperationCb) {
            logger.info("ignored tasks due to ongoing own operation: " +
                this._ownOperationParam.slice());
        } else if (this._greeting) {
            logger.info("ignored tasks due to ongoing operation: " +
                this._greeting.getMembers().toArray());
        } else if (this._ownProposalPr) {
            logger.info("ignored tasks due to ongoing own proposal: " +
                btoa(this._ownProposalHash));
        } else {
            // taskLeave is handled in onPrevSessionFin
            if (this._taskExclude.size) {
                this._proposeGreetInit(ImmutableSet.EMPTY, ImmutableSet.from(this._taskExclude));
            }
            return;
        }

        // probably don't need to reschedule-after-ignore since there's enough
        // hooks elsewhere to do that already
        logger.info("remaining tasks: -" + ImmutableSet.from(this._taskExclude).toArray() +
            "; --" + ImmutableSet.from(this._taskLeave).toArray());
    };

    HybridSession.prototype._assertConsistentTasks = function() {
        _assert(struct.isDisjoint(this._taskExclude, this._taskLeave));
    };

    // Decide responses to others doing certain things

    // Respond to others that intend to leave the overall session.
    // This happens when someone sends two Consistency messages in a row,
    // to some sub-session.
    HybridSession.prototype._onMaybeLeaveIntent = function(sess, evt) {
        var msg = sess.transcript().get(evt.mId);
        if (!Consistency.isFin(msg.body) || msg.author === this._owner) {
            return;
        }
        if (msg.parents.size !== 1) {
            return;
        }
        var pmsg = sess.transcript().get(msg.parents.toArray()[0]);
        if (!Consistency.isFin(pmsg.body) || pmsg.author !== msg.author) {
            return;
        }
        if (this.curMembers().has(msg.author)) {
            this._taskExclude.add(msg.author);
            logger.info("added to taskExclude because they sent a leave-intent: " + msg.author);
            this._maybeHandleTasks();
        }
    };

    HybridSession.prototype._onPrevSessionFin = function() {
        if (!this._channel.curMembers()) {
            return;
        }

        // TODO(xl): [F] (parallel-op) only do the below if we didn't start an operation to
        // reverse their effects in the meantime.
        var pendingLeave = this._channel.curMembers().intersect(this._taskLeave);
        if (pendingLeave.size) {
            this._channel.send({ leave: pendingLeave });
            logger.info("requested channel leave: " + pendingLeave.toArray());
        }

        if (this._curSession === null) {
            this._channel.send({ leave: true });
            logger.info("requested channel leave self");
        }
    };

    HybridSession.prototype._onGreetingComplete = function(greeting) {
        _assert(greeting === this._greeting);
        if (!greeting.getMembers().has(this._owner)) {
            // if we're being excluded, pretend nothing happened and just
            // wait for someone to kick us, as per msg-notes
            throw new Error("OperationIgnored: ignored completed greeting to exclude us");
        }

        if (greeting.metadataIsAuthenticated()) {
            this._serverOrder.setMetadataAuthenticated(greeting.getMetadata().prevPf);
        }

        var self = this;
        var diff = greeting.getPrevMembers().diff(greeting.getMembers());
        var include = diff[0], exclude = diff[1];
        if (exclude.size) {
            exclude.forEach(this._taskExclude.delete.bind(this._taskExclude));
            var toLeave = this._channel.curMembers().intersect(exclude);
            if (toLeave.size) {
                logger.info("added to taskLeave because they were excluded from the session: " + toLeave.toArray());
                toLeave.forEach(this._taskLeave.add.bind(this._taskLeave));
            }
        }
        if (include.size) {
            _assert(!include.subtract(this._channel.curMembers()).size);
        }

        this._assertConsistentTasks();
        return greeting;
    };

    HybridSession.prototype._onOthersEnter = function(others) {
        this._assertConsistentTasks();
        _assert(!others.intersect(this._taskLeave).size);
        var taskExc = others.intersect(this._taskExclude);
        var taskNone = others.subtract(taskExc);
        if (taskExc.size) {
            // we still haven't excluded them cryptographically, and can't
            // allow them to rejoin until we've done this. auto-kick them ASAP.
            // some GKAs allow computation of subgroup keys, but in that case we
            // can model it as a 1-packet membership operation (we need >= 1
            // packet for the ServerOrder accept/reject mechanism) and avoid
            // this code path entirely.
            this._channel.send({ leave: taskExc });
        }
        if (taskNone.size) {
            // TODO(xl): [!] currently this has false positives, implement taskInclude
            // TODO(xl): [D] add a SessionNotice event for this
            logger.info("unexpected users entered the channel: " + taskNone.toArray() +
                "; maybe someone else is including them, or they want to be invited?");
        }
        this._assertConsistentTasks();
    };

    HybridSession.prototype._onOthersLeave = function(others) {
        this._assertConsistentTasks();
        // TODO(xl): [F/D] (parallel-op) if there is an ongoing operation and any
        // leavers are in greeting.new_members then abort the operation, with the
        // "pseudo packet id" definition as mentioned in msg-notes. still put them
        // in pending_exclude, though.
        others.forEach(this._taskLeave.delete.bind(this._taskLeave));
        var toExclude = this.curMembers().intersect(others);
        if (toExclude.size) {
            toExclude.forEach(this._taskExclude.add.bind(this._taskExclude));
            logger.info("added to taskExclude because they left the channel: " + toExclude.toArray());
            this._maybeHandleTasks();
        }
        this._assertConsistentTasks();
    };

    // Receive handlers

    HybridSession.prototype._recv = function(recv_in) {
        if ("pubtxt" in recv_in) {
            if (this._recvGreet(recv_in)) {
                return true;
            } else {
                return this._tryDecrypt.trial(recv_in);
            }
        } else {
            recv_in = channel.checkChannelControl(recv_in);
            var enter = recv_in.enter;
            var leave = recv_in.leave;

            if (leave === true) {
                this._clearChannelRecords();
                this._changeSubSession(null);
            } else if (leave && leave.size) {
                this._onOthersLeave(leave);
            }

            if (enter === true) {
                this._maybeSyncNew(recv_in);
            } else if (enter && enter.size) {
                this._onOthersEnter(enter);
            }

            return true;
        }
    };

    HybridSession.prototype._recvGreet = function(recv_in) {
        var pubtxt = recv_in.pubtxt;
        var sender = recv_in.sender;
        var op = this._greeter.partialDecode(
            this.curMembers(), pubtxt, sender, this._channel.curMembers());
        var self = this;

        if (op !== null) {
            if (this._serverOrder.isSynced() &&
                op.metadata && !this.curMembers().has(op.metadata.author)) {
                logger.info("ignored GKA request from outside of group");
                return false;
            }

            var pHash = utils.sha256(pubtxt);

            var postAcceptInitial = function(pI, prev_pF) {
                // TODO: [F] (handle-error) this may return null, e.g. with malicious packets
                var greeting = self._greeter.decode(
                    self._curGreetState, self.curMembers(), pubtxt, sender,
                    self._channel.curMembers());
                self._setGreeting(greeting);
                self._maybeFinishOwnProposal(pHash, pI, prev_pF, greeting);
            };

            var postAcceptFinal = function(pF, prev_pI) {
                self._maybeFinishOwnProposal(pHash, pF, prev_pI, self._greeting);
            };

            if (this._serverOrder.tryOpPacket(
                    this._owner, op, this._channel.curMembers(), postAcceptInitial, postAcceptFinal)) {
                _assert(this._greeting);
                // accepted greeting packet, deliver it and maybe complete the operation
                var r = this._greeting.recv(recv_in);
                _assert(r);
                if (!this._serverOrder.hasOngoingOp()) {
                    // if this was a final packet, greeting should complete next tick
                    // asynchronous assert; JS promises complete asynchronously
                    Promise.resolve(true) // 1 + number of ticks that clear takes in _setGreeting
                        .then(Promise.resolve.bind(Promise, true))
                        .then(function() { _assert(!self._greeting); })
                        .catch(logger.warn.bind(logger));
                    // TODO(xl): [F] support *non-immediate* asynchronous completion of greeting
                    // This will be much more complex, since for correctness we must not process
                    // certain packets until this is complete. The easy & safe option is to not
                    // process *all* packets, but this has a UI cost and it is OK to process *some*,
                    // just the logic for identifying these will be a bit annoying.
                }
            }
            return true;
        } else if (this._serverOrder.isSynced() && this._serverOrder.hasOngoingOp()) {
            // middle packet of existing operation
            return this._greeting.recv(recv_in);
        } else {
            return false;
        }
    };

    HybridSession.prototype._tryDecryptTimeout = function(recv_in) {
        this._events.publish(new NotDecrypted(this.sId, recv_in.sender, recv_in.pubtxt.length));
        // TODO(xl): [D/R] maybe drop the packet too. though we already got maxsize
    };

    HybridSession.prototype._tryDecryptTry = function(_, recv_in) {
        return this._sessionRecv.publish(recv_in).some(Boolean);
    };

    HybridSession.prototype._changeSubSession = function(greeting) {
        // Rotate to a new sub session with a different membership.
        // If greeting is null, this means we left the channel and the session.

        var ownSet = this._ownSet;
        if (greeting && greeting.getMembers().size === 1) {
            _assert(greeting.getMembers().equals(ownSet));
            greeting = null;
        }

        if (this._prevSession) {
            // this ought to be unnecessary, see python code for details
            this._prevSession.stop();
            this._prevSessionCancel();
            if (!this._prevSession.isConsistent()) {
                this._droppedInconsistentSession = true;
            }
        }

        // Rotate current session to previous
        if (this._curSession) {
            this._prevSession = this._curSession;
            this._prevSessionCancel = this._curSessionCancel;
            this._prevGreetState = this._curGreetState;
            if (this._prevSession.state() === SessionState.JOINED) {
                // this is the only place .fin() should be called, if we're not leaving
                // this is because .fin() places a contract that we're not supposed to send
                // further messages, but we can't possibly guarantee this before a greeting
                // completes.
                this._prevSession.fin();
                this._prevSession.onFin(this._onPrevSessionFin.bind(this));
            }
        }

        var prev_sId = this._prevSession ? btoa(this._prevSession.sId()) : null;
        if (greeting) {
            var sessionCreated = this._makeSubSession(greeting);
            this._curSession = sessionCreated.session;
            this._curSessionCancel = sessionCreated.sessionCancel;
            this._curGreetState = sessionCreated.greetState;
            logger.info("changed session: " + prev_sId + " -> " + btoa(this._curSession.sId()) +
                " with " + this._curSession.curMembers().toArray());

        } else {
            this._curSession = null;
            this._curSessionCancel = null;
            this._curGreetState = null;
            logger.info("changed session: " + prev_sId + " -> " + null);

            this._prevSession.stop();
            this._prevSessionCancel();
        }

        var oldMembers = this._prevSession ? this._prevSession.curMembers() : ownSet;
        var newMembers = greeting ? greeting.getMembers() : ownSet;
        var diff = oldMembers.diff(newMembers);
        _assert(oldMembers.subtract(diff[1]).equals(newMembers.subtract(diff[0])));
        this._events.publish(new SNMembers(newMembers.subtract(diff[0]), diff[0], diff[1]));

        return greeting;
    };

    HybridSession.prototype._makeSubSession = function(greeting) {
        var subSId = greeting.getResultSId();
        var greetState = greeting.getResultState();
        var members = greeting.getMembers();
        var msgSecurity = this._makeMessageSecurity(greetState);

        var sess = new SessionBase(this._context, subSId, members, msgSecurity);

        var cancels = [];
        cancels.push(this._sessionRecv.subscribe(sess.recv.bind(sess)));
        cancels.push(sess.onSend(this._channel.send.bind(this._channel)));
        cancels.push(sess.chainUserEventsTo(this, this._events));
        cancels.push(this._messages.bindSource(sess, sess.transcript()));
        //cancels.push(sess.onEvent(MsgAccepted)(sess.updateFreshness.bind(sess, this._presence)));
        cancels.push(sess.onEvent(MsgAccepted)(this._onMaybeLeaveIntent.bind(this, sess)));

        return {
            session: sess,
            sessionCancel: async.combinedCancel(cancels),
            greetState: greetState
        };
    };

    // implements Session

    /**
     * @inheritDoc
     */
    HybridSession.prototype.sessionId = function() {
        return this._sId;
    };

    /**
     * @inheritDoc
     */
    HybridSession.prototype.owner = function() {
        return this._owner;
    };

    /**
     * @inheritDoc
     */
    HybridSession.prototype.messages = function() {
        return this._messages;
    };

    /**
     * @inheritDoc
     */
    HybridSession.prototype.state = function() {
        return this._curSession ? this._curSession.state() : SessionState.PARTED;
    };

    /**
     * @inheritDoc
     */
    HybridSession.prototype.curMembers = function() {
        return this._curSession ? this._curSession.curMembers() : this._ownSet;
    };

    /**
     * @inheritDoc
     */
    HybridSession.prototype.isConsistent = function() {
        return (!this._droppedInconsistentSession &&
                (!this._prevSession || this._prevSession.isConsistent()) &&
                (!this._curSession || this._curSession.isConsistent()));
    };

    HybridSession.prototype._proposeGreetInit = function(include, exclude) {
        _assert(!this._ownProposalHash);

        if (!this._serverOrder.isSynced()) {
            throw new Error("proposal not appropriate now: need to wait for someone to include you");
        }

        var curMembers = this.curMembers();
        var newMembers = curMembers.patch([include, exclude]);
        _assert(!curMembers.equals(newMembers));

        // concurrency resolution requires that everyone is in the channel when the server
        // echoes back the proposal, which is not exactly the same as when we send it.
        // but check this here anyway, to discourage unlikely-to-succeed workflows.
        var needToJoin = newMembers.subtract(this._channel.curMembers());
        if (needToJoin.size) {
            throw new Error("proposal not appropriate now: not in channel: " + needToJoin.toArray());
        }

        var prevPf = this._serverOrder.prevPf();
        var prevCh = this._serverOrder.prevCh();

        var parents = this._curSession ? this._curSession.transcript().max() : ImmutableSet.EMPTY;
        var pubtxt = this._greeter.encode(this._curGreetState, curMembers, newMembers,
            GreetingMetadata.create(prevPf, prevCh, this._owner, parents));
        var pHash = utils.sha256(pubtxt);

        var p = this._setOwnProposal(prevPf, pHash);
        logger.info("proposed new greeting pHash:" + btoa(pHash) +
            ": +{" + include.toArray() + "} -{" + exclude.toArray() + "}");
        this._channel.send({ pubtxt: pubtxt, recipients: curMembers.union(include) });
        return p;
    };

    HybridSession.prototype._changeMembership = function(include, exclude) {
        throw new Error("not implemented");
    };

    HybridSession.prototype._includeSelf = function() {
        throw new Error("not implemented");
    };

    HybridSession.prototype._excludeSelf = function() {
        throw new Error("not implemented");
    };

    HybridSession.prototype._runOwnOperation = function(opParam, run) {
        if (!this._ownOperationCb) {
            var p = run();
            this._setOwnOperation(p, opParam);
            return p;

        } else if (this._ownOperationParam.equals(opParam)) {
            return this._ownOperationCb;
        } else {
            throw new Error("OperationInProgress: " + this._ownOperationParam);
        }
    };

    /**
     * @inheritDoc
     */
    HybridSession.prototype.send = function(action) {
        if ("contents" in action) {
            return this._curSession ? this._curSession.sendData(action.contents) : false;
        } else {
            return this.execute(action) !== null;
        }
    };

    /**
     * @inheritDoc
     */
    HybridSession.prototype.execute = function(action) {
        if ("contents" in action) {
            throw new Error("not implemented");
        } else if ("include" in action || "exclude" in action) {
            throw new Error("not implemented");
        } else if ("join" in action || "part" in action) {
            throw new Error("not implemented");
        } else {
            throw new Error("invalid action: " + action);
        }
    };

    /**
     * @inheritDoc
     */
    HybridSession.prototype.onRecv = function(sub) {
        // subscribe the given subscriber to all events
        var evtctx = this._events;
        return async.combinedCancel(
            evtctx.evtcls().toArray().map(function(ec) {
                return evtctx.subscribe(ec)(sub);
            }));
    };


    ns.HybridSession = HybridSession;

    return ns;
});
