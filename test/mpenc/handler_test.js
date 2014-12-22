/**
 * @fileOverview
 * Test of the `mpenc/handler` module.
 */

/*
 * Created: 27 Feb 2014 Guy K. Kloss <gk@mega.co.nz>
 *
 * (c) 2014 by Mega Limited, Wellsford, New Zealand
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
    "mpenc/handler",
    "mpenc/helper/utils",
    "mpenc/codec",
    "mpenc/version",
    "chai",
    "sinon/assert",
    "sinon/sandbox",
    "sinon/spy",
    "sinon/stub",
    "asmcrypto",
], function(ns, utils, codec, version,
        chai, sinon_assert, sinon_sandbox, sinon_spy, stub, asmCrypto) {
    "use strict";

    var assert = chai.assert;

    var _echo = function(x) { return x; };

    // set test data
    _td.DATA_MESSAGE_CONTENT.protocol = version.PROTOCOL_VERSION;

    // Create/restore Sinon stub/spy/mock sandboxes.
    var sandbox = null;

    beforeEach(function() {
        sandbox = sinon_sandbox.create();
    });

    afterEach(function() {
        sandbox.restore();
    });

    function _stripProtoFromMessage(message) {
        var _PROTO_STRING = '?mpENC:';
        if (!message) {
            return null;
        }
        return atob(message.substring(_PROTO_STRING.length, message.length - 1));
    }

    function _getPayload(message, senderParticipant) {
        if (message && senderParticipant) {
            var content = codec.categoriseMessage(_stripProtoFromMessage(message.message)).content;
            var groupKey = senderParticipant.cliquesMember.groupKey
                                   ? senderParticipant.cliquesMember.groupKey.substring(0, 16)
                                   : null;
            return codec.decodeMessageContent(content, groupKey,
                                              senderParticipant.askeMember.ephemeralPubKey);
        } else {
            return null;
        }
    }

    function _getSender(message, participants, members) {
        if (!message) {
            return null;
        }
        var index = members.indexOf(message.from);
        return participants[index];
    }

    describe("ProtocolHandler class", function() {
        describe('constructor', function() {
            it('fails for missing params', function() {
                assert.throws(function() { new ns.ProtocolHandler('42', _td.ED25519_PRIV_KEY, _td.ED25519_PUB_KEY); },
                              "Constructor call missing required parameters.");
            });

            it('just make an instance', function() {
                var handler = new ns.ProtocolHandler('42',
                                                     _td.ED25519_PRIV_KEY,
                                                     _td.ED25519_PUB_KEY,
                                                     _td.STATIC_PUB_KEY_DIR);
                assert.strictEqual(handler.id, '42');
                assert.ok(handler.staticPubKeyDir.get('3'));
                assert.deepEqual(handler.askeMember.staticPrivKey, _td.ED25519_PRIV_KEY);
                assert.ok(handler.askeMember.staticPubKeyDir);
                assert.ok(handler.cliquesMember);
            });
        });

        describe('#_mergeMessages() method', function() {
            it('fail for mismatching senders', function() {
                var participant = new ns.ProtocolHandler('1',
                                                         _td.ED25519_PRIV_KEY, _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                var cliquesMessage = {source: '1', dest: '2', agreement: 'ika', flow: 'up',
                                      members: ['1', '2', '3', '4', '5', '6'], intKeys: null};
                var askeMessage = {source: '2', dest: '2', flow: 'up',
                                   members: ['1', '2', '3', '4', '5', '6'],
                                   nonces: null, pubKeys: null, sessionSignature: null};
                assert.throws(function() { participant._mergeMessages(cliquesMessage, askeMessage); },
                              "Message source mismatch, this shouldn't happen.");
            });

            it('fail for mismatching receivers', function() {
                var participant = new ns.ProtocolHandler('1',
                                                         _td.ED25519_PRIV_KEY, _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                var cliquesMessage = {source: '1', dest: '2', agreement: 'ika', flow: 'up',
                                      members: ['1', '2', '3', '4', '5', '6'], intKeys: null};
                var askeMessage = {source: '1', dest: '', flow: 'up',
                                   members: ['1', '2', '3', '4', '5', '6'],
                                   nonces: null, pubKeys: null, sessionSignature: null};
                assert.throws(function() { participant._mergeMessages(cliquesMessage, askeMessage); },
                              "Message destination mismatch, this shouldn't happen.");
            });

            it('merge the messages', function() {
                var participant = new ns.ProtocolHandler('1',
                                                         _td.ED25519_PRIV_KEY, _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                var cliquesMessage = {source: '1', dest: '2', agreement: 'ika', flow: 'up',
                                      members: ['1', '2', '3', '4', '5', '6'], intKeys: null};
                var askeMessage = {source: '1', dest: '2', flow: 'up',
                                   members: ['1', '2', '3', '4', '5', '6'],
                                   nonces: null, pubKeys: null, sessionSignature: null};
                var message = participant._mergeMessages(cliquesMessage, askeMessage);
                assert.strictEqual(message.source, cliquesMessage.source);
                assert.strictEqual(message.dest, cliquesMessage.dest);
                assert.deepEqual(message.members, cliquesMessage.members);
                assert.deepEqual(message.intKeys, cliquesMessage.intKeys);
                assert.deepEqual(message.nonces, askeMessage.nonces);
                assert.deepEqual(message.pubKeys, askeMessage.pubKeys);
                assert.strictEqual(message.sessionSignature, askeMessage.sessionSignature);
            });

            it('merge the messages for ASKE only', function() {
                var participant = new ns.ProtocolHandler('1',
                                                         _td.ED25519_PRIV_KEY, _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                var askeMessage = {source: '3', dest: '', flow: 'down',
                                   members: ['1', '2', '3', '4', '5', '6'],
                                   nonces: null, pubKeys: null, sessionSignature: null,
                                   signingKey: null};
                var message = participant._mergeMessages(null, askeMessage);
                assert.strictEqual(message.source, '1');
                assert.strictEqual(message.dest, askeMessage.dest);
                assert.deepEqual(message.members, askeMessage.members);
                assert.deepEqual(message.intKeys, null);
                assert.deepEqual(message.nonces, askeMessage.nonces);
                assert.deepEqual(message.pubKeys, askeMessage.pubKeys);
                assert.strictEqual(message.sessionSignature, askeMessage.sessionSignature);
                assert.strictEqual(message.signingKey, null);
            });

            it('merge the messages for CLIQUES only', function() {
                var participant = new ns.ProtocolHandler('1',
                                                         _td.ED25519_PRIV_KEY, _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                var cliquesMessage = {source: '1', dest: '', agreement: 'aka', flow: 'down',
                                      members: ['1', '2', '3', '4', '5'], intKeys: null};
                var message = participant._mergeMessages(cliquesMessage, null);
                assert.strictEqual(message.source, '1');
                assert.strictEqual(message.dest, cliquesMessage.dest);
                assert.deepEqual(message.members, cliquesMessage.members);
                assert.deepEqual(message.intKeys, cliquesMessage.intKeys);
            });

            it('merge the messages for final case (no messages)', function() {
                var participant = new ns.ProtocolHandler('1',
                                                         _td.ED25519_PRIV_KEY, _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                var message = participant._mergeMessages(null, undefined);
                assert.strictEqual(message, null);
            });
        });

        describe('#_getCliquesMessage() method', function() {
            it('the vanilla ika case', function() {
                var message = {
                    source: '1',
                    dest: '2',
                    messageType: codec.MESSAGE_TYPE.INIT_INITIATOR_UP,
                    members: ['1', '2', '3', '4', '5', '6'],
                    intKeys: null,
                    nonces: null,
                    pubKeys: null,
                    sessionSignature: null
                };

                var participant = new ns.ProtocolHandler('1',
                                                         _td.ED25519_PRIV_KEY, _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                var compare = {source: '1', dest: '2', agreement: 'ika', flow: 'up',
                               members: ['1', '2', '3', '4', '5', '6'], intKeys: []};
                var cliquesMessage = participant._getCliquesMessage(
                        new codec.ProtocolMessage(message));
                assert.strictEqual(cliquesMessage.source, compare.source);
                assert.strictEqual(cliquesMessage.dest, compare.dest);
                assert.strictEqual(cliquesMessage.flow, compare.flow);
                assert.strictEqual(cliquesMessage.agreement, compare.agreement);
                assert.deepEqual(cliquesMessage.members, compare.members);
                assert.deepEqual(cliquesMessage.intKeys, compare.intKeys);
            });
        });

        describe('#_getAskeMessage() method', function() {
            it('the vanilla initial case', function() {
                var message = {
                    source: '1',
                    dest: '2',
                    messageType: codec.MESSAGE_TYPE.INIT_INITIATOR_UP,
                    members: ['1', '2', '3', '4', '5', '6'],
                    intKeys: null,
                    nonces: null,
                    pubKeys: null,
                    sessionSignature: null,
                    signingKey: null,
                };

                var participant = new ns.ProtocolHandler('1',
                                                         _td.ED25519_PRIV_KEY, _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                var compare = {source: '1', dest: '2', flow: 'up',
                               members: ['1', '2', '3', '4', '5', '6'],
                               nonces: [], pubKeys: [], sessionSignature: null,
                               signingKey: null};
                var askeMessage = participant._getAskeMessage(
                        new codec.ProtocolMessage(message));
                assert.strictEqual(askeMessage.source, compare.source);
                assert.strictEqual(askeMessage.dest, compare.dest);
                assert.strictEqual(askeMessage.flow, compare.flow);
                assert.deepEqual(askeMessage.members, compare.members);
                assert.deepEqual(askeMessage.nonces, compare.nonces);
                assert.deepEqual(askeMessage.pubKeys, compare.pubKeys);
                assert.deepEqual(askeMessage.sessionSignature, compare.sessionSignature);
                assert.strictEqual(askeMessage.signingKey, compare.signingKey);
            });

            it('auxiliary downflow case for a quit', function() {
                var participant = new ns.ProtocolHandler('1',
                                                         _td.ED25519_PRIV_KEY, _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                var compare = {source: '1', dest: '', flow: 'down',
                               signingKey: _td.ED25519_PRIV_KEY};
                var askeMessage = participant._getAskeMessage(
                        new codec.ProtocolMessage(_td.DOWNFLOW_MESSAGE_CONTENT));
                assert.strictEqual(askeMessage.source, compare.source);
                assert.strictEqual(askeMessage.dest, compare.dest);
                assert.strictEqual(askeMessage.flow, compare.flow);
                assert.strictEqual(askeMessage.signingKey, compare.signingKey);
            });
        });

        describe('#_start() method', function() {
            it('start/initiate a group session', function() {
                var participant = new ns.ProtocolHandler('1',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                sandbox.spy(participant.cliquesMember, 'ika');
                sandbox.spy(participant.askeMember, 'commit');
                sandbox.stub(participant, '_mergeMessages').returns(new codec.ProtocolMessage());
                var otherMembers = ['2', '3', '4', '5', '6'];
                var message = participant._start(otherMembers);
                sinon_assert.calledOnce(participant.cliquesMember.ika);
                sinon_assert.calledOnce(participant.askeMember.commit);
                sinon_assert.calledOnce(participant._mergeMessages);
                assert.strictEqual(message.messageType, codec.MESSAGE_TYPE.INIT_INITIATOR_UP);
            });
        });

        describe('#start() method', function() {
            it('start/initiate a group session', function() {
                var participant = new ns.ProtocolHandler('jake@blues.org/android123',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                var message = {message: "I'm puttin' the band back together!",
                               dest: 'elwood@blues.org/ios1234'};
                sandbox.stub(codec, 'encodeMessage', _echo);
                sandbox.stub(participant, '_start').returns(message);
                participant.start(['elwood@blues.org/ios1234']);
                sinon_assert.calledOnce(codec.encodeMessage);
                sinon_assert.calledOnce(participant._start);
                assert.lengthOf(participant.protocolOutQueue, 1);
                assert.deepEqual(participant.protocolOutQueue[0].message, message);
                assert.strictEqual(participant.protocolOutQueue[0].from, 'jake@blues.org/android123');
                assert.strictEqual(participant.protocolOutQueue[0].to, 'elwood@blues.org/ios1234');
                assert.lengthOf(participant.messageOutQueue, 0);
                assert.lengthOf(participant.uiQueue, 0);
                assert.strictEqual(participant.state, ns.STATE.INIT_UPFLOW);
            });

            it('illegal state transition', function() {
                var participant = new ns.ProtocolHandler('jake@blues.org/android123',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                var illegalStates = [ns.STATE.INIT_UPFLOW,
                                     ns.STATE.INIT_DOWNFLOW,
                                     ns.STATE.READY,
                                     ns.STATE.AUX_UPFLOW,
                                     ns.STATE.AUX_DOWNFLOW];
                for (var i = 0; i < illegalStates.length; i++) {
                    participant.state = illegalStates[i];
                    assert.throws(function() { participant.start(); },
                                  'start() can only be called from an uninitialised state.');
                }
            });
        });

        describe('#_join() method', function() {
            it('join empty member list', function() {
                var participant = new ns.ProtocolHandler('1',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                assert.throws(function() { participant._join([]); },
                              'No members to add.');
            });

            it('add members to group', function() {
                var participant = new ns.ProtocolHandler('1',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                participant.cliquesMember.akaJoin = sinon_spy();
                participant.askeMember.join = sinon_spy();
                sandbox.stub(participant, '_mergeMessages').returns(new codec.ProtocolMessage());
                var otherMembers = ['6', '7'];
                var message = participant._join(otherMembers);
                sinon_assert.calledOnce(participant.cliquesMember.akaJoin);
                sinon_assert.calledOnce(participant.askeMember.join);
                sinon_assert.calledOnce(participant._mergeMessages);
                assert.strictEqual(message.messageType, codec.MESSAGE_TYPE.JOIN_AUX_INITIATOR_UP);
            });
        });

        describe('#join() method', function() {
            it('add members to group', function() {
                var participant = new ns.ProtocolHandler('jake@blues.org/android123',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                participant.state = ns.STATE.READY;
                var message = {message: "I'm puttin' the band back together!",
                               dest: 'ray@charles.org/ios1234'};
                sandbox.stub(codec, 'encodeMessage', _echo);
                sandbox.stub(participant, '_join').returns(message);
                participant.join(['ray@charles.org/ios1234']);
                sinon_assert.calledOnce(codec.encodeMessage);
                sinon_assert.calledOnce(participant._join);
                assert.lengthOf(participant.protocolOutQueue, 1);
                assert.deepEqual(participant.protocolOutQueue[0].message, message);
                assert.strictEqual(participant.protocolOutQueue[0].from, 'jake@blues.org/android123');
                assert.strictEqual(participant.protocolOutQueue[0].to, 'ray@charles.org/ios1234');
                assert.lengthOf(participant.messageOutQueue, 0);
                assert.lengthOf(participant.uiQueue, 0);
                assert.strictEqual(participant.state, ns.STATE.AUX_UPFLOW);
            });

            it('illegal state transition', function() {
                var participant = new ns.ProtocolHandler('jake@blues.org/android123',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                var illegalStates = [ns.STATE.NULL,
                                     ns.STATE.INIT_UPFLOW,
                                     ns.STATE.INIT_DOWNFLOW,
                                     ns.STATE.AUX_UPFLOW,
                                     ns.STATE.AUX_DOWNFLOW];
                for (var i = 0; i < illegalStates.length; i++) {
                    participant.state = illegalStates[i];
                    assert.throws(function() { participant.join(); },
                                  'join() can only be called from a ready state.');
                }
            });
        });

        describe('#_exclude() method', function() {
            it('exclude empty member list', function() {
                var participant = new ns.ProtocolHandler('3',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                assert.throws(function() { participant._exclude([]); },
                              'No members to exclude.');
            });

            it('exclude self', function() {
                var participant = new ns.ProtocolHandler('3',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                assert.throws(function() { participant._exclude(['3', '5']); },
                              'Cannot exclude mysefl.');
            });

            it('exclude members', function() {
                var participant = new ns.ProtocolHandler('3',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                participant.cliquesMember.akaExclude = sinon_spy();
                participant.askeMember.exclude = sinon_spy();
                sandbox.stub(participant, '_mergeMessages').returns(new codec.ProtocolMessage());
                var message = participant._exclude(['1', '4']);
                sinon_assert.calledOnce(participant.cliquesMember.akaExclude);
                sinon_assert.calledOnce(participant.askeMember.exclude);
                sinon_assert.calledOnce(participant._mergeMessages);
                assert.strictEqual(message.messageType, codec.MESSAGE_TYPE.EXCLUDE_AUX_INITIATOR_DOWN);
            });
        });

        describe('#exclude() method', function() {
            it('exclude members', function() {
                var participant = new ns.ProtocolHandler('a.dumbledore@hogwarts.ac.uk/android123',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                participant.state = ns.STATE.READY;
                var message = {message: "You're fired!",
                               members: ['a.dumbledore@hogwarts.ac.uk/android123', 'further.staff'],
                               dest: ''};
                sandbox.stub(codec, 'encodeMessage', _echo);
                sandbox.stub(participant, '_exclude').returns(message);
                participant.exclude(['g.lockhart@hogwarts.ac.uk/ios1234']);
                sinon_assert.calledOnce(codec.encodeMessage);
                sinon_assert.calledOnce(participant._exclude);
                assert.lengthOf(participant.protocolOutQueue, 1);
                assert.deepEqual(participant.protocolOutQueue[0].message, message);
                assert.strictEqual(participant.protocolOutQueue[0].from, 'a.dumbledore@hogwarts.ac.uk/android123');
                assert.strictEqual(participant.protocolOutQueue[0].to, '');
                assert.lengthOf(participant.messageOutQueue, 0);
                assert.lengthOf(participant.uiQueue, 0);
                assert.strictEqual(participant.state, ns.STATE.AUX_DOWNFLOW);
            });

            it('exclude members in recovery', function() {
                var participant = new ns.ProtocolHandler('mccoy@ncc-1701.mil/android123',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                participant.state = ns.STATE.AUX_DOWNFLOW;
                participant.recovering = true;
                var message = {message: "He's dead, Jim!",
                               members: ['mccoy@ncc-1701.mil/android123', 'kirk@ncc-1701.mil/android456'],
                               dest: ''};
                sandbox.stub(codec, 'encodeMessage', _echo);
                sandbox.stub(participant, '_exclude').returns(message);
                participant.exclude(['red.shirt@ncc-1701.mil/ios1234']);
                sinon_assert.calledOnce(codec.encodeMessage);
                sinon_assert.calledOnce(participant._exclude);
                assert.lengthOf(participant.protocolOutQueue, 1);
                assert.deepEqual(participant.protocolOutQueue[0].message, message);
                assert.strictEqual(participant.protocolOutQueue[0].from, 'mccoy@ncc-1701.mil/android123');
                assert.strictEqual(participant.protocolOutQueue[0].to, '');
                assert.lengthOf(participant.messageOutQueue, 0);
                assert.lengthOf(participant.uiQueue, 0);
                assert.strictEqual(participant.state, ns.STATE.AUX_DOWNFLOW);
                assert.strictEqual(participant.recovering, true);
            });

            it('illegal state transition', function() {
                var participant = new ns.ProtocolHandler('jake@blues.org/android123',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                var illegalStates = [ns.STATE.NULL,
                                     ns.STATE.INIT_UPFLOW,
                                     ns.STATE.INIT_DOWNFLOW,
                                     ns.STATE.AUX_UPFLOW,
                                     ns.STATE.AUX_DOWNFLOW];
                for (var i = 0; i < illegalStates.length; i++) {
                    participant.state = illegalStates[i];
                    assert.throws(function() { participant.exclude(); },
                                  'exclude() can only be called from a ready state.');
                }
            });

            it('illegal state transition on recovery', function() {
                var participant = new ns.ProtocolHandler('jake@blues.org/android123',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                participant.recovering = true;
                var illegalStates = [ns.STATE.NULL,
                                     ns.STATE.INIT_UPFLOW,
                                     ns.STATE.AUX_UPFLOW];
                for (var i = 0; i < illegalStates.length; i++) {
                    participant.state = illegalStates[i];
                    assert.throws(function() { participant.exclude(); },
                                  'exclude() for recovery can only be called from a ready or downflow state.');
                }
            });

            it('exclude last peer --> quit()', function() {
                var participant = new ns.ProtocolHandler('chingachgook@mohicans.org/android123',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                participant.state = ns.STATE.READY;
                participant.members = ['chingachgook@mohicans.org/android123',
                                       'uncas@mohicans.org/ios1234'];
                var message = {message: "My poor son!",
                               members: ['chingachgook@mohicans.org/android123'],
                               dest: ''};
                sandbox.stub(participant, '_exclude').returns(message);
                sandbox.stub(participant, 'quit');
                participant.exclude(['uncas@mohicans.org/ios1234']);
                sinon_assert.calledOnce(participant._exclude);
                sinon_assert.calledOnce(participant.quit);
            });
        });

        describe('#_quit() method', function() {
            it('simple test', function() {
                var participant = new ns.ProtocolHandler('Peter',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                participant.askeMember.ephemeralPrivKey = _td.ED25519_PRIV_KEY;
                sandbox.spy(participant.askeMember, 'quit');
                sandbox.stub(participant.cliquesMember, 'akaQuit');
                sandbox.stub(participant, '_mergeMessages').returns(new codec.ProtocolMessage());
                var message = participant._quit();
                sinon_assert.calledOnce(participant.askeMember.quit);
                sinon_assert.calledOnce(participant.cliquesMember.akaQuit);
                sinon_assert.calledOnce(participant._mergeMessages);
                assert.strictEqual(message.messageType, codec.MESSAGE_TYPE.QUIT_DOWN);
            });
        });

        describe('#quit() method', function() {
            it('no-op test, already in QUIT', function() {
                var participant = new ns.ProtocolHandler('Peter@genesis.co.uk/android4711',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                participant.state =  ns.STATE.QUIT;
                sandbox.spy(participant, '_quit');
                participant.quit();
                assert.strictEqual(participant._quit.callCount, 0);
            });

            it('simple test', function() {
                var participant = new ns.ProtocolHandler('Peter@genesis.co.uk/android4711',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                participant.state =  ns.STATE.READY;
                participant.askeMember.ephemeralPrivKey = _td.ED25519_PRIV_KEY;
                var message = {signingKey: 'Sledge Hammer',
                               source: 'Peter@genesis.co.uk/android4711',
                               dest: ''};
                sandbox.stub(codec, 'encodeMessage', _echo);
                participant._quit = stub().returns(message);
                participant.quit();
                sinon_assert.calledOnce(codec.encodeMessage);
                sinon_assert.calledOnce(participant._quit);
                assert.lengthOf(participant.protocolOutQueue, 1);
                assert.deepEqual(participant.protocolOutQueue[0].message, message);
                assert.strictEqual(participant.protocolOutQueue[0].from, 'Peter@genesis.co.uk/android4711');
                assert.strictEqual(participant.protocolOutQueue[0].to, '');
                assert.lengthOf(participant.messageOutQueue, 0);
                assert.lengthOf(participant.uiQueue, 0);
                assert.strictEqual(participant.state, ns.STATE.QUIT);
            });

            it('impossible call situation', function() {
                var participant = new ns.ProtocolHandler('jake@blues.org/android123',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                participant.state = ns.STATE.NULL;
                assert.throws(function() { participant.quit(); },
                              'Not participating.');
            });

            it('#quit() in workflow', function() {
                // Initialise members.
                var numMembers = 2;
                var participants = {};
                for (var i = 1; i <= numMembers; i++) {
                    participants[i.toString()] = new ns.ProtocolHandler(i.toString(),
                                                                        _td.ED25519_PRIV_KEY,
                                                                        _td.ED25519_PUB_KEY,
                                                                        _td.STATIC_PUB_KEY_DIR);
                }

                // Start.
                participants['1'].start(['2']);
                assert.strictEqual(participants['1'].state, ns.STATE.INIT_UPFLOW);
                var protocolMessage = participants['1'].protocolOutQueue.shift();

                // Processing start/upflow message.
                participants['2'].processMessage(protocolMessage);
                protocolMessage = participants['2'].protocolOutQueue.shift();
                assert.strictEqual(participants['2'].state, ns.STATE.INIT_DOWNFLOW);
                participants['1'].processMessage(protocolMessage);
                protocolMessage = participants['1'].protocolOutQueue.shift();
                assert.strictEqual(participants['1'].state, ns.STATE.READY);

                // Participant 2 should process the last confirmation message.
                participants['2'].processMessage(protocolMessage);
                // Participant 2 is also ready.
                assert.strictEqual(participants['2'].state, ns.STATE.READY);

                participants['1'].quit();
            });
        });

        describe('#_refresh() method', function() {
            it('refresh own private key using aka', function() {
                var participant = new ns.ProtocolHandler('3',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                participant._mergeMessages = stub().returns(new codec.ProtocolMessage());
                participant.cliquesMember.akaRefresh = sinon_spy();
                var message = participant._refresh();
                sinon_assert.calledOnce(participant.cliquesMember.akaRefresh);
                sinon_assert.calledOnce(participant._mergeMessages);
                assert.strictEqual(message.messageType, codec.MESSAGE_TYPE.REFRESH_AUX_INITIATOR_DOWN);
            });
        });

        describe('#refresh() method', function() {
            it('refresh own private key using aka', function() {
                var participant = new ns.ProtocolHandler('dj.jazzy.jeff@rapper.com/android123',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                participant.state =  ns.STATE.READY;
                var message = {message: "Fresh Prince",
                               dest: ''};
                sandbox.stub(codec, 'encodeMessage', _echo);
                participant._refresh = stub().returns(message);
                participant.refresh();
                sinon_assert.calledOnce(codec.encodeMessage);
                sinon_assert.calledOnce(participant._refresh);
                assert.lengthOf(participant.protocolOutQueue, 1);
                assert.deepEqual(participant.protocolOutQueue[0].message, message);
                assert.strictEqual(participant.protocolOutQueue[0].from, 'dj.jazzy.jeff@rapper.com/android123');
                assert.strictEqual(participant.protocolOutQueue[0].to, '');
                assert.lengthOf(participant.messageOutQueue, 0);
                assert.lengthOf(participant.uiQueue, 0);
                assert.strictEqual(participant.state, ns.STATE.READY);
            });

            it('illegal state transition', function() {
                var participant = new ns.ProtocolHandler('jake@blues.org/android123',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                var illegalStates = [ns.STATE.NULL,
                                     ns.STATE.INIT_UPFLOW,
                                     ns.STATE.AUX_UPFLOW];
                for (var i = 0; i < illegalStates.length; i++) {
                    participant.state = illegalStates[i];
                    assert.throws(function() { participant.refresh(); },
                                  'refresh() can only be called from a ready or downflow states.');
                }
            });
        });

        describe('#fullRefresh() method', function() {
            it('refresh all using ika', function() {
                var participant = new ns.ProtocolHandler('Earth',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                participant.state =  ns.STATE.AUX_UPFLOW;
                var members = ['Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter',
                               'Saturn', 'Uranus', 'Neptune', 'Pluto'];
                participant.askeMember.members = utils.clone(members);
                participant.cliquesMember.members = utils.clone(members);
                var message = {message: "Pluto's not a planet any more!!",
                               members: ['Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter',
                                         'Saturn', 'Uranus', 'Neptune'],
                               dest: 'Mercury'};
                sandbox.stub(codec, 'encodeMessage', _echo);
                sandbox.stub(participant, '_start').returns(message);
                var keepMembers = ['Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter',
                                   'Saturn', 'Uranus', 'Neptune'];
                participant.fullRefresh(keepMembers);
                sinon_assert.calledOnce(codec.encodeMessage);
                sinon_assert.calledOnce(participant._start);
                sinon.assert.calledWith(participant._start,
                                        ['Mercury', 'Venus', 'Mars', 'Jupiter',
                                         'Saturn', 'Uranus', 'Neptune']);
                assert.lengthOf(participant.protocolOutQueue, 1);
                assert.deepEqual(participant.protocolOutQueue[0].message, message);
                assert.strictEqual(participant.protocolOutQueue[0].from, 'Earth');
                assert.strictEqual(participant.protocolOutQueue[0].to, 'Mercury');
                assert.lengthOf(participant.messageOutQueue, 0);
                assert.lengthOf(participant.uiQueue, 0);
                assert.strictEqual(participant.state, ns.STATE.INIT_UPFLOW);
            });

            it('refresh by excluding last peer --> quit()', function() {
                var participant = new ns.ProtocolHandler('chingachgook@mohicans.org/android123',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                participant.state =  ns.STATE.AUX_UPFLOW;
                var members = ['chingachgook@mohicans.org/android123',
                               'uncas@mohicans.org/ios1234'];
                participant.members = members;
                participant.askeMember.members = utils.clone(members);
                participant.cliquesMember.members = utils.clone(members);
                var message = {message: "The last of us!",
                               members: ['chingachgook@mohicans.org/android123'],
                               dest: ''};
                sandbox.stub(participant, '_start').returns(message);
                sandbox.stub(participant, 'quit');
                participant.fullRefresh(['uncas@mohicans.org/ios1234']);
                sinon_assert.calledOnce(participant._start);
                sinon_assert.calledOnce(participant.quit);
            });
        });

        describe('#recover() method', function() {
            it('simplest recover', function() {
                var participant = new ns.ProtocolHandler('beatrix@kiddo.com/android123',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                participant.state =  ns.STATE.AUX_DOWNFLOW;
                sandbox.stub(participant, 'refresh');
                participant.recover();
                sinon_assert.calledOnce(participant.refresh);
                assert.strictEqual(participant.recovering, true);
            });

            it('full recover', function() {
                var participant = new ns.ProtocolHandler('beatrix@kiddo.com/android123',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                participant.state =  ns.STATE.AUX_UPFLOW;
                sandbox.stub(participant.askeMember, 'discardAuthentications');
                sandbox.stub(participant, 'fullRefresh');
                participant.recover();
                sinon_assert.calledOnce(participant.askeMember.discardAuthentications);
                sinon_assert.calledOnce(participant.fullRefresh);
                assert.strictEqual(participant.recovering, true);
            });

            it('recover with members to keep', function() {
                var participant = new ns.ProtocolHandler('beatrix@kiddo.com/android123',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                participant.state =  ns.STATE.AUX_DOWNFLOW;
                var message = {message: "You're dead!",
                               dest: ''};
                participant.askeMember.members = ['beatrix@kiddo.com/android123',
                                                  'vernita@green.com/outlook4711',
                                                  'o-ren@ishi.jp/ios1234'];
                sandbox.stub(participant.askeMember, 'discardAuthentications');
                sandbox.stub(participant, 'exclude');
                sandbox.stub(codec, 'encodeMessage', _echo);
                participant.recover(['beatrix@kiddo.com/android123', 'o-ren@ishi.jp/ios1234']);
                sinon_assert.calledOnce(participant.askeMember.discardAuthentications);
                sinon_assert.calledOnce(participant.exclude);
                assert.strictEqual(participant.recovering, true);
            });
        });

        describe('#_processKeyingMessage() method', function() {
            it('processing for an upflow message', function() {
                var message = { source: '1', dest: '2',
                                messageType: codec.MESSAGE_TYPE.INIT_INITIATOR_UP,
                                members: ['1', '2', '3', '4', '5'],
                                intKeys: [null, []], debugKeys: [null, '1*G'],
                                nonces: ['foo'], pubKeys: ['foo'],
                                sessionSignature: null };
                var compare = { source: '2', dest: '3',
                                messageType: codec.MESSAGE_TYPE.INIT_PARTICIPANT_UP,
                                members: ['1', '2', '3', '4', '5'],
                                intKeys: [[], [], []], debugKeys: ['2*G', '1*G', '2*1*G'],
                                nonces: ['foo', 'bar'], pubKeys: ['foo', 'bar'],
                                sessionSignature: null };
                var participant = new ns.ProtocolHandler('2',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                sandbox.stub(codec, 'decodeMessageContent', _echo);
                sandbox.stub(codec, 'encodeMessage', _echo);
                var result = participant._processKeyingMessage(new codec.ProtocolMessage(message));
                assert.strictEqual(result.newState, ns.STATE.INIT_UPFLOW);
                var output = result.decodedMessage;
                assert.strictEqual(output.source, compare.source);
                assert.strictEqual(output.dest, compare.dest);
                assert.strictEqual(output.messageType, compare.messageType);
                assert.deepEqual(output.members, compare.members);
                assert.lengthOf(output.intKeys, compare.intKeys.length);
                assert.deepEqual(output.debugKeys, compare.debugKeys);
                assert.lengthOf(output.nonces, compare.nonces.length);
                assert.lengthOf(output.pubKeys, compare.pubKeys.length);
                assert.strictEqual(output.sessionSignature, compare.sessionSignature);
            });

            it('processing for last upflow message', function() {
                var message = { source: '4', dest: '5',
                                messageType: codec.MESSAGE_TYPE.INIT_PARTICIPANT_UP,
                                members: ['1', '2', '3', '4', '5'],
                                intKeys: [[], [], [], [], []],
                                debugKeys: ['', '', '', '', ''],
                                nonces: ['foo1', 'foo2', 'foo3', 'foo4'],
                                pubKeys: ['foo1', 'foo2', 'foo3', 'foo4'],
                                sessionSignature: null };
                var compare = { source: '5', dest: '',
                                messageType: codec.MESSAGE_TYPE.INIT_PARTICIPANT_DOWN,
                                members: ['1', '2', '3', '4', '5'],
                                intKeys: [[], [], [], [], []],
                                nonces: ['foo1', 'foo2', 'foo3', 'foo4', 'foo5'],
                                pubKeys: ['foo1', 'foo2', 'foo3', 'foo4', 'foo5'],
                                sessionSignature: 'bar' };
                var participant = new ns.ProtocolHandler('5',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                participant.state = ns.STATE.NULL;
                sandbox.stub(codec, 'decodeMessageContent', _echo);
                sandbox.stub(codec, 'encodeMessage', _echo);

                var result = participant._processKeyingMessage(new codec.ProtocolMessage(message));
                assert.strictEqual(result.newState, ns.STATE.INIT_DOWNFLOW);
                var output = result.decodedMessage;
                assert.strictEqual(output.source, compare.source);
                assert.strictEqual(output.dest, compare.dest);
                assert.strictEqual(output.messageType, compare.messageType);
                assert.deepEqual(output.members, compare.members);
                assert.lengthOf(output.intKeys, compare.intKeys.length);
                assert.lengthOf(output.nonces, compare.nonces.length);
                assert.lengthOf(output.pubKeys, compare.pubKeys.length);
                assert.ok(output.sessionSignature);
            });

            it('processing for recovery upflow message', function() {
                var message = { source: '4', dest: '5',
                                messageType: codec.MESSAGE_TYPE.RECOVER_INIT_PARTICIPANT_UP,
                                members: ['1', '2', '3', '4', '5'],
                                intKeys: [[], [], [], [], []],
                                debugKeys: ['', '', '', '', ''],
                                nonces: ['foo1', 'foo2', 'foo3', 'foo4'],
                                pubKeys: ['foo1', 'foo2', 'foo3', 'foo4'],
                                sessionSignature: null };
                var compare = { source: '5', dest: '',
                                messageType: codec.MESSAGE_TYPE.RECOVER_INIT_PARTICIPANT_DOWN,
                                members: ['1', '2', '3', '4', '5'],
                                intKeys: [[], [], [], [], []],
                                nonces: ['foo1', 'foo2', 'foo3', 'foo4', 'foo5'],
                                pubKeys: ['foo1', 'foo2', 'foo3', 'foo4', 'foo5'],
                                sessionSignature: 'bar' };
                var participant = new ns.ProtocolHandler('5',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                participant.state = ns.STATE.AUX_DOWNFLOW;
                participant.askeMember.authenticatedMembers= [true, true, true, true, true]
                sandbox.stub(codec, 'decodeMessageContent', _echo);
                sandbox.stub(codec, 'encodeMessage', _echo);

                var result = participant._processKeyingMessage(new codec.ProtocolMessage(message));
                assert.strictEqual(participant.recovering, true);
                assert.deepEqual(participant.askeMember.authenticatedMembers, [false, false, false, false, true]);
                assert.strictEqual(result.newState, ns.STATE.INIT_DOWNFLOW);
                var output = result.decodedMessage;
                assert.strictEqual(output.source, compare.source);
                assert.strictEqual(output.dest, compare.dest);
                assert.strictEqual(output.messageType, compare.messageType);
                assert.deepEqual(output.members, compare.members);
                assert.lengthOf(output.intKeys, compare.intKeys.length);
                assert.lengthOf(output.nonces, compare.nonces.length);
                assert.lengthOf(output.pubKeys, compare.pubKeys.length);
                assert.ok(output.sessionSignature);
            });

            it('processing for a downflow message', function() {
                var message = { source: '5', dest: '',
                                messageType: codec.MESSAGE_TYPE.INIT_PARTICIPANT_DOWN,
                                members: ['1', '2', '3', '4', '5'],
                                intKeys: [[], [], [], [], []],
                                debugKeys: ['5*4*3*2*G', '5*4*3*1*G', '5*4*2*1*G',
                                            '5*3*2*1*G', '4*3*2*1*G'],
                                nonces: ['foo1', 'foo2', 'foo3', 'foo4', 'foo5'],
                                pubKeys: ['foo1', 'foo2', 'foo3', 'foo4', 'foo5'],
                                sessionSignature: 'bar' };
                var participant = new ns.ProtocolHandler('2',
                                                       _td.ED25519_PRIV_KEY,
                                                       _td.ED25519_PUB_KEY,
                                                       _td.STATIC_PUB_KEY_DIR);
                participant.state = ns.STATE.INIT_UPFLOW;
                sandbox.spy(participant.cliquesMember, 'upflow');
                sandbox.stub(participant.cliquesMember, 'downflow');
                sandbox.spy(participant.askeMember, 'upflow');
                sandbox.stub(participant.askeMember, 'downflow');
                sandbox.stub(participant, '_mergeMessages').returns(new codec.ProtocolMessage({dest: ''}));
                sandbox.stub(codec, 'decodeMessageContent', _echo);
                sandbox.stub(codec, 'encodeMessage', _echo);
                var result = participant._processKeyingMessage(new codec.ProtocolMessage(message));
                assert.strictEqual(result.newState, ns.STATE.INIT_DOWNFLOW);
                assert.strictEqual(participant.cliquesMember.upflow.callCount, 0);
                assert.strictEqual(participant.askeMember.upflow.callCount, 0);
                sinon_assert.calledOnce(participant.cliquesMember.downflow);
                sinon_assert.calledOnce(participant.askeMember.downflow);
                sinon_assert.calledOnce(participant._mergeMessages);
            });

            it('processing for a downflow message after CLIQUES finish', function() {
                var message = { source: '5', dest: '',
                                messageType: codec.MESSAGE_TYPE.INIT_PARTICIPANT_CONFIRM_DOWN,
                                members: ['1', '2', '3', '4', '5'],
                                intKeys: [], debugKeys: [],
                                nonces: ['foo1', 'foo2', 'foo3', 'foo4', 'foo5'],
                                pubKeys: ['foo1', 'foo2', 'foo3', 'foo4', 'foo5'],
                                sessionSignature: 'bar' };
                var participant = new ns.ProtocolHandler('2',
                                                       _td.ED25519_PRIV_KEY,
                                                       _td.ED25519_PUB_KEY,
                                                       _td.STATIC_PUB_KEY_DIR);
                participant.state = ns.STATE.INIT_DOWNFLOW;
                sandbox.spy(participant.cliquesMember, 'upflow');
                sandbox.stub(participant.cliquesMember, 'downflow');
                sandbox.spy(participant.askeMember, 'upflow');
                sandbox.stub(participant.askeMember, 'downflow');
                sandbox.stub(participant, '_mergeMessages').returns(new codec.ProtocolMessage({dest: ''}));
                sandbox.stub(codec, 'decodeMessageContent', _echo);
                sandbox.stub(codec, 'encodeMessage', _echo);
                sandbox.stub(participant.askeMember, 'isSessionAcknowledged').returns(true);
                var result = participant._processKeyingMessage(new codec.ProtocolMessage(message));
                assert.strictEqual(result.newState, ns.STATE.READY);
                assert.strictEqual(participant.cliquesMember.upflow.callCount, 0);
                assert.strictEqual(participant.askeMember.upflow.callCount, 0);
                assert.strictEqual(participant.cliquesMember.downflow.callCount, 0);
                sinon_assert.calledOnce(participant._mergeMessages);
                sinon_assert.calledOnce(participant.askeMember.downflow);
                sinon_assert.calledOnce(participant.askeMember.isSessionAcknowledged);
            });

            it('processing for a downflow quit message', function() {
                var participant = new ns.ProtocolHandler('2',
                                                       _td.ED25519_PRIV_KEY,
                                                       _td.ED25519_PUB_KEY,
                                                       _td.STATIC_PUB_KEY_DIR);
                participant.state = ns.STATE.READY;
                participant.askeMember.ephemeralPubKeys = {'1': _td.ED25519_PUB_KEY};
                sandbox.stub(codec, 'decodeMessageContent', _echo);
                sandbox.stub(codec, 'encodeMessage', _echo);
                var result = participant._processKeyingMessage(
                        new codec.ProtocolMessage(_td.DOWNFLOW_MESSAGE_CONTENT));
                assert.strictEqual(participant.askeMember.oldEphemeralKeys['1'].priv, _td.ED25519_PRIV_KEY);
                assert.strictEqual(participant.askeMember.oldEphemeralKeys['1'].pub, _td.ED25519_PUB_KEY);
            });

            it('processing for a downflow message after a quit', function() {
                var participant = new ns.ProtocolHandler('2',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                participant.state = ns.STATE.QUIT;
                sandbox.stub(codec, 'decodeMessageContent', _echo);
                sandbox.stub(codec, 'encodeMessage', _echo);
                var result = participant._processKeyingMessage(
                        new codec.ProtocolMessage(_td.DOWNFLOW_MESSAGE_CONTENT));
                assert.strictEqual(result, null);
                assert.strictEqual(participant.state, ns.STATE.QUIT);
            });

            it('processing for a downflow without me in it', function() {
                var participant = new ns.ProtocolHandler('2',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                var message = { source: '1', dest: '',
                                messageType: codec.MESSAGE_TYPE.EXCLUDE_AUX_INITIATOR_DOWN,
                                members: ['1', '3', '4', '5'] };
                participant.state = ns.STATE.READY;
                sandbox.stub(codec, 'decodeMessageContent', _echo);
                sandbox.stub(participant, 'quit');
                var result = participant._processKeyingMessage(
                        new codec.ProtocolMessage(message));
                assert.strictEqual(result, null);
                sinon_assert.calledOnce(participant.quit);
            });

            it('processing for an upflow message not for me', function() {
                var participant = new ns.ProtocolHandler('2',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                var message = { source: '3', dest: '4',
                                messageType: codec.MESSAGE_TYPE.INIT_PARTICIPANT_UP,
                                members: ['1', '3', '2', '4', '5'] };
                participant.state = ns.STATE.INIT_UPFLOW;
                sandbox.stub(codec, 'decodeMessageContent', _echo);
                var result = participant._processKeyingMessage(
                        new codec.ProtocolMessage(message));
                assert.strictEqual(result, null);
            });

            it('processing for a downflow from me', function() {
                var participant = new ns.ProtocolHandler('1',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                var message = { source: '1', dest: '',
                                messageType: codec.MESSAGE_TYPE.EXCLUDE_AUX_INITIATOR_DOWN,
                                members: ['1', '3', '4', '5'] };
                participant.state = ns.STATE.AUX_DOWNFLOW;
                sandbox.stub(codec, 'decodeMessageContent', _echo);
                var result = participant._processKeyingMessage(
                        new codec.ProtocolMessage(message));
                assert.strictEqual(result, null);
            });
        });

        describe('#send() method', function() {
            it('send a message confidentially', function() {
                var participant = new ns.ProtocolHandler('orzabal@tearsforfears.co.uk/android123',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                participant.exponentialPadding = 0;
                participant.cliquesMember.groupKey = _td.COMP_KEY;
                participant.askeMember.ephemeralPrivKey = _td.ED25519_PRIV_KEY;
                participant.askeMember.ephemeralPubKey = _td.ED25519_PUB_KEY;
                participant.state = ns.STATE.READY;
                var message = 'Shout, shout, let it all out!';
                participant.send(message);
                assert.lengthOf(participant.messageOutQueue, 1);
                assert.lengthOf(participant.messageOutQueue[0].message, 188);
                assert.strictEqual(participant.messageOutQueue[0].from, 'orzabal@tearsforfears.co.uk/android123');
                assert.strictEqual(participant.messageOutQueue[0].to, '');
                assert.lengthOf(participant.protocolOutQueue, 0);
                assert.lengthOf(participant.uiQueue, 0);
            });

            it('send a message confidentially with exponential padding', function() {
                var participant = new ns.ProtocolHandler('orzabal@tearsforfears.co.uk/android123',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                participant.cliquesMember.groupKey = _td.COMP_KEY;
                participant.askeMember.ephemeralPrivKey = _td.ED25519_PRIV_KEY;
                participant.askeMember.ephemeralPubKey = _td.ED25519_PUB_KEY;
                participant.state = ns.STATE.READY;
                var message = 'Shout, shout, let it all out!';
                participant.send(message);
                assert.lengthOf(participant.messageOutQueue, 1);
                assert.lengthOf(participant.messageOutQueue[0].message, 316);
                assert.strictEqual(participant.messageOutQueue[0].from, 'orzabal@tearsforfears.co.uk/android123');
                assert.strictEqual(participant.messageOutQueue[0].to, '');
                assert.lengthOf(participant.protocolOutQueue, 0);
                assert.lengthOf(participant.uiQueue, 0);
            });

            it('on uninitialised state', function() {
                var participant = new ns.ProtocolHandler('kenny@southpark.com/android123',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                participant.state = ns.STATE.INIT_DOWNFLOW;
                assert.throws(function() { participant.send('Wassup?'); },
                              'Messages can only be sent in ready state.');
            });
        });

        describe('#sendTo() method', function() {
            it('send a directed message confidentially', function() {
                var participant = new ns.ProtocolHandler('jennifer@rush.com/android123',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                participant.exponentialPadding = 0;
                participant.cliquesMember.groupKey = _td.COMP_KEY;
                participant.askeMember.ephemeralPrivKey = _td.ED25519_PRIV_KEY;
                participant.askeMember.ephemeralPubKey = _td.ED25519_PUB_KEY;
                participant.state = ns.STATE.READY;
                var message = 'Whispers in the morning ...';
                participant.sendTo(message, 'my_man@rush.com/ios12345');
                assert.lengthOf(participant.messageOutQueue, 1);
                assert.lengthOf(participant.messageOutQueue[0].message, 188);
                assert.strictEqual(participant.messageOutQueue[0].from, 'jennifer@rush.com/android123');
                assert.strictEqual(participant.messageOutQueue[0].to, 'my_man@rush.com/ios12345');
                assert.lengthOf(participant.protocolOutQueue, 0);
                assert.lengthOf(participant.uiQueue, 0);
            });

            it('send a directed message confidentially with exponential padding', function() {
                var participant = new ns.ProtocolHandler('jennifer@rush.com/android123',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                participant.cliquesMember.groupKey = _td.COMP_KEY;
                participant.askeMember.ephemeralPrivKey = _td.ED25519_PRIV_KEY;
                participant.askeMember.ephemeralPubKey = _td.ED25519_PUB_KEY;
                participant.state = ns.STATE.READY;
                var message = 'Whispers in the morning ...';
                participant.sendTo(message, 'my_man@rush.com/ios12345');
                assert.lengthOf(participant.messageOutQueue, 1);
                assert.lengthOf(participant.messageOutQueue[0].message, 316);
                assert.strictEqual(participant.messageOutQueue[0].from, 'jennifer@rush.com/android123');
                assert.strictEqual(participant.messageOutQueue[0].to, 'my_man@rush.com/ios12345');
                assert.lengthOf(participant.protocolOutQueue, 0);
                assert.lengthOf(participant.uiQueue, 0);
            });
        });

        describe('#sendError() method', function() {
            it('send an mpENC protocol error message', function() {
                var participant = new ns.ProtocolHandler('a.dumbledore@hogwarts.ac.uk/android123',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                participant.askeMember.ephemeralPrivKey = _td.ED25519_PRIV_KEY;
                participant.askeMember.ephemeralPubKey = _td.ED25519_PUB_KEY;
                participant.state = ns.STATE.AUX_DOWNFLOW;
                var message = 'Signature verification for q.quirrell@hogwarts.ac.uk/wp8possessed666 failed.';
                participant.sendError(ns.ERROR.TERMINAL, message);
                var outMessage = participant.protocolOutQueue[0].message;
                assert.strictEqual(participant.protocolOutQueue[0].message, _td.ERROR_MESSAGE_PAYLOAD);
                assert.strictEqual(participant.protocolOutQueue[0].from, participant.id);
                assert.strictEqual(participant.protocolOutQueue[0].to, '');
                assert.lengthOf(participant.uiQueue, 0);
            });

            it('illegal error severity', function() {
                var participant = new ns.ProtocolHandler('asok@dilbertsintern.org/android123',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                var message = 'Problem retrieving public key for: PointyHairedBoss';
                assert.throws(function() { participant.sendError(42, message); },
                              'Illegal error severity: 42.');
            });
        });

        describe('#inspectMessage() method', function() {
            it('on plain text message', function() {
                var participant = new ns.ProtocolHandler('1',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                var message = {message: 'Pōkarekare ana ngā wai o Waitemata, whiti atu koe hine marino ana e.',
                               from: 'kiri@singer.org.nz/waiata42'};
                var result = participant.inspectMessage(message);
                assert.deepEqual(result, {type: 'plain'});
            });

            it('on error message', function() {
                var participant = new ns.ProtocolHandler('1',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                var message = {message: '?mpENC Error:Hatschi!',
                               from: 'common@cold.govt.nz/flu2'};
                var result = participant.inspectMessage(message);
                assert.deepEqual(result, {type: 'mpENC error'});
            });

            it('on binary data message', function() {
                var participant = new ns.ProtocolHandler('1',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                participant.state = ns.STATE.READY;
                var message = {message: _td.DATA_MESSAGE_PAYLOAD,
                               from: 'bar@baz.nl/blah123'};
                var result = participant.inspectMessage(message);
                assert.deepEqual(result, {type: 'mpENC data message'});
            });

            it('on query message', function() {
                var participant = new ns.ProtocolHandler('1',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                var message = {message: '?mpENCv' + version.PROTOCOL_VERSION.charCodeAt(0) + '?foo.',
                               from: 'raw@hide.com/rollingrollingrolling'};
                var result = participant.inspectMessage(message);
                assert.deepEqual(result, {type: 'mpENC query'});
            });

            it("initial start message for other", function() {
                var participant = new ns.ProtocolHandler('3',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                sandbox.stub(codec, 'inspectMessageContent').returns(
                             {type: null, protocol: 1,
                              from: '1', to: '2', origin: null,
                              agreement: 'initial', flow: 'up',
                              fromInitiator: null, negotiation: null,
                              members: ['1', '2', '3', '4', '5'],
                              numNonces: 1, numIntKeys: 2, numPubKeys: 1});
                var message = {message: _td.UPFLOW_MESSAGE_PAYLOAD,
                               from: 'bar@baz.nl/blah123'};
                var expected = {protocol: 1,
                                from: '1', to: '2', origin: '???',
                                agreement: 'initial', flow: 'up',
                                fromInitiator: true, negotiation: 'start other',
                                members: ['1', '2', '3', '4', '5'],
                                numNonces: 1, numIntKeys: 2, numPubKeys: 1};
                var result = participant.inspectMessage(message);
                assert.ok(_tu.deepCompare(result, expected));
            });

            it("initial start message for me", function() {
                var participant = new ns.ProtocolHandler('2',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                sandbox.stub(codec, 'inspectMessageContent').returns(
                             {type: null, protocol: 1,
                              from: '1', to: '2', origin: null,
                              agreement: 'initial', flow: 'up',
                              fromInitiator: null, negotiation: null,
                              members: ['1', '2', '3', '4', '5'],
                              numNonces: 1, numIntKeys: 2, numPubKeys: 1});
                var message = {message: _td.UPFLOW_MESSAGE_PAYLOAD,
                               from: 'bar@baz.nl/blah123'};
                var expected = {protocol: 1,
                                from: '1', to: '2', origin: '???',
                                agreement: 'initial', flow: 'up',
                                fromInitiator: true, negotiation: 'start me',
                                members: ['1', '2', '3', '4', '5'],
                                numNonces: 1, numIntKeys: 2, numPubKeys: 1};
                var result = participant.inspectMessage(message);
                assert.ok(_tu.deepCompare(result, expected));
            });

            it('on own quit binary message', function() {
                var participant = new ns.ProtocolHandler('1',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                participant.askeMember.members = ['1', '2', '3', '4', '5'];
                var message = {message: _td.DOWNFLOW_MESSAGE_PAYLOAD,
                               from: '1'};
                var expected = {protocolVersion: 1,
                                messageType: 0xd3,
                                messageTypeString: 'QUIT_DOWN',
                                from: '1', to: '',
                                origin: 'initiator (self)',
                                operation: 'QUIT',
                                agreement: 'auxiliary',
                                flow: 'down',
                                recover: false,
                                members: [],
                                numNonces: 0, numIntKeys: 0, numPubKeys: 0};
                var result = participant.inspectMessage(message);
                assert.ok(_tu.deepCompare(result, expected));
            });

            it("on someone's quit binary message", function() {
                var participant = new ns.ProtocolHandler('2',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                participant.askeMember.members = ['1', '2', '3', '4', '5'];
                var message = {message: _td.DOWNFLOW_MESSAGE_PAYLOAD,
                               from: '1'};
                var expected = {protocol: 1,
                                from: '1', to: '',
                                origin: 'initiator',
                                agreement: 'auxiliary',
                                flow: 'down',
                                members: [],
                                numNonces: 0, numIntKeys: 0, numPubKeys: 0};
                var result = participant.inspectMessage(message);
                assert.ok(_tu.deepCompare(result, expected));
            });

            it('exclude me message', function() {
                var participant = new ns.ProtocolHandler('2',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                participant.askeMember.members = ['1', '2', '3', '4', '5'];
                sandbox.stub(codec, 'inspectMessageContent').returns(
                             {type: null, protocol: 1,
                              from: '1', to: '', origin: null,
                              agreement: 'auxiliary', flow: 'down',
                              fromInitiator: null, negotiation: null,
                              members: ['1', '3', '4', '5'],
                              numNonces: 0, numIntKeys: 4, numPubKeys: 0});
                var message = {message: _td.DOWNFLOW_MESSAGE_PAYLOAD,
                               from: 'bar@baz.nl/blah123'};
                var expected = {protocol: 1,
                                from: '1', to: '', origin: 'participant',
                                agreement: 'auxiliary', flow: 'down',
                                fromInitiator: true, negotiation: 'exclude me',
                                members: ['1', '3', '4', '5'],
                                numNonces: 0, numIntKeys: 4, numPubKeys: 0};
                var result = participant.inspectMessage(message);
                assert.ok(_tu.deepCompare(result, expected));
            });

            it("exclude other message", function() {
                var participant = new ns.ProtocolHandler('3',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                participant.askeMember.members = ['1', '2', '3', '4', '5'];
                sandbox.stub(codec, 'inspectMessageContent').returns(
                             {type: null, protocol: 1,
                              from: '1', to: '', origin: null,
                              agreement: 'auxiliary', flow: 'down',
                              fromInitiator: null, negotiation: null,
                              members: ['1', '3', '4', '5'],
                              numNonces: 0, numIntKeys: 4, numPubKeys: 0});
                var message = {message: _td.DOWNFLOW_MESSAGE_PAYLOAD,
                               from: 'bar@baz.nl/blah123'};
                var expected = {protocol: 1,
                                from: '1', to: '', origin: 'participant',
                                agreement: 'auxiliary', flow: 'down',
                                fromInitiator: true, negotiation: 'exclude other',
                                members: ['1', '3', '4', '5'],
                                numNonces: 0, numIntKeys: 4, numPubKeys: 0};
                var result = participant.inspectMessage(message);
                assert.ok(_tu.deepCompare(result, expected));
            });

            it('join me message', function() {
                var participant = new ns.ProtocolHandler('5',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                participant.askeMember.members = [];
                sandbox.stub(codec, 'inspectMessageContent').returns(
                             {type: null, protocol: 1,
                              from: '1', to: '5', origin: null,
                              agreement: 'auxiliary', flow: 'up',
                              fromInitiator: null, negotiation: null,
                              members: ['1', '2', '3', '4', '5'],
                              numNonces: 4, numIntKeys: 5, numPubKeys: 4});
                var message = {message: _td.DOWNFLOW_MESSAGE_PAYLOAD,
                               from: 'bar@baz.nl/blah123'};
                var expected = {protocol: 1,
                                from: '1', to: '5', origin: '???',
                                agreement: 'auxiliary', flow: 'up',
                                fromInitiator: null, negotiation: 'join me',
                                members: ['1', '2', '3', '4', '5'],
                                numNonces: 4, numIntKeys: 5, numPubKeys: 4};
                var result = participant.inspectMessage(message);
                assert.ok(_tu.deepCompare(result, expected));
            });

            it("join other message", function() {
                var participant = new ns.ProtocolHandler('4',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                participant.askeMember.members = ['1', '2', '3', '4'];
                sandbox.stub(codec, 'inspectMessageContent').returns(
                             {type: null, protocol: 1,
                              from: '1', to: '5', origin: null,
                              agreement: 'auxiliary', flow: 'up',
                              fromInitiator: null, negotiation: null,
                              members: ['1', '2', '3', '4', '5'],
                              numNonces: 4, numIntKeys: 5, numPubKeys: 4});
                var message = {message: _td.DOWNFLOW_MESSAGE_PAYLOAD,
                               from: 'bar@baz.nl/blah123'};
                var expected = {protocol: 1,
                                from: '1', to: '5', origin: 'participant',
                                agreement: 'auxiliary', flow: 'up',
                                fromInitiator: true, negotiation: 'join other',
                                members: ['1', '2', '3', '4', '5'],
                                numNonces: 4, numIntKeys: 5, numPubKeys: 4};
                var result = participant.inspectMessage(message);
                assert.ok(_tu.deepCompare(result, expected));
            });

            it("join other message chained", function() {
                var participant = new ns.ProtocolHandler('4',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                participant.askeMember.members = ['1', '2', '3', '4'];
                sandbox.stub(codec, 'inspectMessageContent').returns(
                             {type: null, protocol: 1,
                              from: '5', to: '6', origin: null,
                              agreement: 'auxiliary', flow: 'up',
                              fromInitiator: null, negotiation: null,
                              members: ['1', '2', '3', '4', '5', '6'],
                              numNonces: 5, numIntKeys: 6, numPubKeys: 5});
                var message = {message: _td.DOWNFLOW_MESSAGE_PAYLOAD,
                               from: 'bar@baz.nl/blah123'};
                var expected = {protocol: 1,
                                from: '5', to: '6', origin: 'outsider',
                                agreement: 'auxiliary', flow: 'up',
                                fromInitiator: false, negotiation: 'join other',
                                members: ['1', '2', '3', '4', '5', '6'],
                                numNonces: 5, numIntKeys: 6, numPubKeys: 5};
                var result = participant.inspectMessage(message);
                assert.ok(_tu.deepCompare(result, expected));
            });

            it("join message (not involved)", function() {
                var participant = new ns.ProtocolHandler('4',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                sandbox.stub(codec, 'inspectMessageContent').returns(
                             {type: null, protocol: 1,
                              from: '1', to: '5', origin: null,
                              agreement: 'auxiliary', flow: 'up',
                              fromInitiator: null, negotiation: null,
                              members: ['1', '2', '3', '5'],
                              numNonces: 3, numIntKeys: 4, numPubKeys: 3});
                var message = {message: _td.DOWNFLOW_MESSAGE_PAYLOAD,
                               from: 'bar@baz.nl/blah123'};
                var expected = {protocol: 1,
                                from: '1', to: '5', origin: '???',
                                agreement: 'auxiliary', flow: 'up',
                                fromInitiator: null, negotiation: 'join (not involved)',
                                members: ['1', '2', '3', '5'],
                                numNonces: 3, numIntKeys: 4, numPubKeys: 3};
                var result = participant.inspectMessage(message);
                assert.ok(_tu.deepCompare(result, expected));
            });

            it("refresh message", function() {
                var participant = new ns.ProtocolHandler('4',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                participant.askeMember.members = ['1', '2', '3', '4', '5'];
                sandbox.stub(codec, 'inspectMessageContent').returns(
                             {type: null, protocol: 1,
                              from: '1', to: '', origin: null,
                              agreement: 'auxiliary', flow: 'down',
                              fromInitiator: null, negotiation: null,
                              members: ['1', '2', '3', '4', '5'],
                              numNonces: 0, numIntKeys: 5, numPubKeys: 0});
                var message = {message: _td.DOWNFLOW_MESSAGE_PAYLOAD,
                               from: 'bar@baz.nl/blah123'};
                var expected = {protocol: 1,
                                from: '1', to: '', origin: 'participant',
                                agreement: 'auxiliary', flow: 'down',
                                fromInitiator: true, negotiation: 'refresh',
                                members: ['1', '2', '3', '4', '5'],
                                numNonces: 0, numIntKeys: 5, numPubKeys: 0};
                var result = participant.inspectMessage(message);
                assert.ok(_tu.deepCompare(result, expected));
            });
        });

        describe('#processMessage() method', function() {
            it('on plain text message', function() {
                var participant = new ns.ProtocolHandler('2',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                var message = {message: 'Pōkarekare ana ngā wai o Waitemata, whiti atu koe hine marino ana e.',
                               from: 'kiri@singer.org.nz/waiata42'};
                participant.processMessage(message);
                assert.lengthOf(participant.protocolOutQueue, 1);
                assert.strictEqual(participant.protocolOutQueue[0].message.substring(0, 9),
                                   '?mpENCv' + version.PROTOCOL_VERSION.charCodeAt(0) + '?');
                assert.strictEqual(participant.protocolOutQueue[0].from,
                                   '2');
                assert.strictEqual(participant.protocolOutQueue[0].to,
                                   'kiri@singer.org.nz/waiata42');
                assert.lengthOf(participant.messageOutQueue, 0);
                assert.lengthOf(participant.uiQueue, 1);
                assert.strictEqual(participant.uiQueue[0].type, 'info');
                assert.strictEqual(participant.uiQueue[0].message,
                                   'Received unencrypted message, requesting encryption.');
            });

            it('on error message', function() {
                var participant = new ns.ProtocolHandler('2',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                var message = {message: '?mpENC Error:Hatschi!',
                               from: 'common@cold.govt.nz/flu2'};
                participant.processMessage(message);
                assert.lengthOf(participant.protocolOutQueue, 0);
                assert.lengthOf(participant.messageOutQueue, 0);
                assert.lengthOf(participant.uiQueue, 1);
                assert.strictEqual(participant.uiQueue[0].type, 'error');
                assert.strictEqual(participant.uiQueue[0].message,
                                   'Error in mpENC protocol: Hatschi!');
            });

            it('on keying message', function() {
                var participant = new ns.ProtocolHandler('2',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                var groupKey = _td.COMP_KEY.substring(0, 16);
                participant.cliquesMember.groupKey = groupKey;
                participant.askeMember.ephemeralPubKey = _td.ED25519_PUB_KEY;
                var message = {message: _td.DOWNFLOW_MESSAGE_PAYLOAD,
                               from: 'bar@baz.nl/blah123'};
                sandbox.stub(codec, 'categoriseMessage').returns(
                        { category: codec.MESSAGE_CATEGORY.MPENC_GREET_MESSAGE,
                          content: 'foo' });
                sandbox.stub(codec, 'decodeMessageContent').returns(_td.DOWNFLOW_MESSAGE_STRING);
                sandbox.stub(participant, '_processKeyingMessage').returns(
                        { decodedMessage: _td.DOWNFLOW_MESSAGE_STRING,
                          newState: ns.STATE.READY });
                sandbox.stub(codec, 'encodeMessage', _echo);
                participant.processMessage(message);
                sinon_assert.calledOnce(codec.categoriseMessage);
                sinon_assert.calledOnce(codec.decodeMessageContent);
                sinon_assert.calledOnce(participant._processKeyingMessage);
                sinon_assert.calledOnce(codec.encodeMessage);
                assert.lengthOf(participant.protocolOutQueue, 1);
                assert.strictEqual(participant.protocolOutQueue[0].message, _td.DOWNFLOW_MESSAGE_STRING);
                assert.strictEqual(participant.protocolOutQueue[0].from, '2');
                assert.lengthOf(participant.messageOutQueue, 0);
                assert.lengthOf(participant.uiQueue, 0);
            });

            it('on own keying message with flushed ephemeralPubKeys', function() {
                var participant = new ns.ProtocolHandler('1',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                participant.cliquesMember.groupKey = _td.COMP_KEY.substring(0, 16);
                participant.askeMember.ephemeralPubKeys = [];
                participant.askeMember.ephemeralPubKey = _td.ED25519_PUB_KEY;
                var message = {message: _td.DOWNFLOW_MESSAGE_PAYLOAD,
                               from: '1'};
                sandbox.stub(codec, 'categoriseMessage').returns(
                        { category: codec.MESSAGE_CATEGORY.MPENC_GREET_MESSAGE,
                          content: 'foo' });
                sandbox.stub(codec, 'decodeMessageContent').returns(_td.DOWNFLOW_MESSAGE_STRING);
                sandbox.stub(participant, '_processKeyingMessage').returns(
                        { decodedMessage: _td.DOWNFLOW_MESSAGE_STRING,
                          newState: ns.STATE.READY });
                sandbox.stub(codec, 'encodeMessage', _echo);
                participant.processMessage(message);
                sinon_assert.calledOnce(codec.categoriseMessage);
                sinon_assert.calledOnce(codec.decodeMessageContent);
                assert.strictEqual(codec.decodeMessageContent.getCall(0).args[2], _td.ED25519_PUB_KEY);
                sinon_assert.calledOnce(participant._processKeyingMessage);
                sinon_assert.calledOnce(codec.encodeMessage);
                assert.lengthOf(participant.protocolOutQueue, 1);
                assert.strictEqual(participant.protocolOutQueue[0].message, _td.DOWNFLOW_MESSAGE_STRING);
                assert.strictEqual(participant.protocolOutQueue[0].from, '1');
                assert.lengthOf(participant.messageOutQueue, 0);
                assert.lengthOf(participant.uiQueue, 0);
            });

            it('on data message', function() {
                var participant = new ns.ProtocolHandler('2',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                participant.state = ns.STATE.READY;
                var groupKey = _td.COMP_KEY.substring(0, 16);
                participant.cliquesMember.groupKey = groupKey;
                participant.askeMember.ephemeralPubKey = _td.ED25519_PUB_KEY;
                var message = {message: _td.DATA_MESSAGE_PAYLOAD,
                               from: 'bar@baz.nl/blah123'};
                sandbox.stub(codec, 'decodeMessageContent').returns(_td.DATA_MESSAGE_CONTENT);
                sandbox.stub(participant.askeMember, 'getMemberEphemeralPubKey').returns('lala');
                participant.processMessage(message);
                sinon_assert.calledOnce(codec.decodeMessageContent);
                assert.lengthOf(codec.decodeMessageContent.getCall(0).args, 3);
                assert.strictEqual(codec.decodeMessageContent.getCall(0).args[1],
                                   groupKey);
                assert.strictEqual(codec.decodeMessageContent.getCall(0).args[2],
                                   'lala');
                assert.lengthOf(participant.protocolOutQueue, 0);
                assert.lengthOf(participant.messageOutQueue, 0);
                assert.lengthOf(participant.uiQueue, 1);
                assert.strictEqual(participant.uiQueue[0].type, 'message');
                assert.strictEqual(participant.uiQueue[0].message,
                                   'foo');
            });

            it('on data message, invalid signature', function() {
                var participant = new ns.ProtocolHandler('2',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                participant.state = ns.STATE.READY;
                var groupKey = _td.COMP_KEY.substring(0, 16);
                participant.cliquesMember.groupKey = groupKey;
                participant.askeMember.ephemeralPubKey = _td.ED25519_PUB_KEY;
                var decodedContent = utils.clone(_td.DATA_MESSAGE_CONTENT);
                decodedContent.signatureOk = false;
                var message = {message: _td.DATA_MESSAGE_PAYLOAD,
                               from: 'bar@baz.nl/blah123'};
                sandbox.stub(codec, 'decodeMessageContent').returns(decodedContent);
                participant.processMessage(message);
                sinon_assert.calledOnce(codec.decodeMessageContent);
                assert.lengthOf(participant.protocolOutQueue, 0);
                assert.lengthOf(participant.messageOutQueue, 0);
                assert.lengthOf(participant.uiQueue, 1);
                assert.strictEqual(participant.uiQueue[0].type, 'error');
                assert.strictEqual(participant.uiQueue[0].message,
                                   'Signature of received message invalid.');
            });

            it('on query message', function() {
                var participant = new ns.ProtocolHandler('2',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                var message = {message: '?mpENCv' + version.PROTOCOL_VERSION.charCodeAt(0) + '?foo.',
                               from: 'raw@hide.com/rollingrollingrolling'};
                participant.start = stub();
                participant.processMessage(message);
                sinon_assert.calledOnce(participant.start);
            });

            it('on quit message', function() {
                var participant = new ns.ProtocolHandler('2',
                                                         _td.ED25519_PRIV_KEY,
                                                         _td.ED25519_PUB_KEY,
                                                         _td.STATIC_PUB_KEY_DIR);
                var message = {message: '?mpENCv' + version.PROTOCOL_VERSION.charCodeAt(0) + '?foo.',
                               from: 'raw@hide.com/rollingrollingrolling'};
                participant.start = stub();
                participant.processMessage(message);
                sinon_assert.calledOnce(participant.start);
            });

            it('whole flow for 3 members, 2 joining, 2 others leaving, send message, refresh key, full recovery', function() {
                // Extend timeout, this test takes longer.
                this.timeout(30000);
                var numMembers = 3;
                var initiator = 0;
                var members = [];
                var participants = [];
                for (var i = 1; i <= numMembers; i++) {
                    members.push(i.toString());
                    var newMember = new ns.ProtocolHandler(i.toString(),
                                                           _td.ED25519_PRIV_KEY,
                                                           _td.ED25519_PUB_KEY,
                                                           _td.STATIC_PUB_KEY_DIR);
                    participants.push(newMember);
                }
                var otherMembers = [];
                for (var i = 2; i <= numMembers; i++) {
                    otherMembers.push(i.toString());
                }

                var startTime = Math.round(Date.now() / 1000);
                console.log('Starting at ' + Math.round(Date.now() / 1000 - startTime));
                // Start.
                participants[initiator].start(otherMembers);
                var message = participants[initiator].protocolOutQueue.shift();
                var payload = _getPayload(message, _getSender(message, participants, members));
                assert.strictEqual(participants[initiator].state, ns.STATE.INIT_UPFLOW);

                console.log('Upflow for start at ' + Math.round(Date.now() / 1000 - startTime));
                // Upflow.
                while (message && payload.dest !== '') {
                    var nextId = payload.members.indexOf(payload.dest);
                    participants[nextId].processMessage(message);
                    message = participants[nextId].protocolOutQueue.shift();
                    payload = _getPayload(message, _getSender(message, participants, members));

                    if (payload.dest === '') {
                        assert.strictEqual(participants[nextId].state, ns.STATE.INIT_DOWNFLOW);
                    } else {
                        assert.strictEqual(participants[nextId].state, ns.STATE.INIT_UPFLOW);
                    }
                }

                console.log('Downflow for start at ' + Math.round(Date.now() / 1000 - startTime));
                // Downflow.
                var nextMessages = [];
                while (payload) {
                    for (var i = 0; i < participants.length; i++) {
                        var participant = participants[i];
                        if (members.indexOf(participant.id) < 0) {
                            continue;
                        }
                        participant.processMessage(message);
                        var nextMessage =  participant.protocolOutQueue.shift();
                        if (nextMessage) {
                            nextMessages.push(utils.clone(nextMessage));
                        }
                        if (participant.askeMember.isSessionAcknowledged()) {
                            assert.strictEqual(participant.state, ns.STATE.READY);
                        } else {
                            assert.strictEqual(participant.state, ns.STATE.INIT_DOWNFLOW);
                        }
                        assert.deepEqual(participant.cliquesMember.members, members);
                        assert.deepEqual(participant.askeMember.members, members);
                    }
                    message = nextMessages.shift();
                    payload = _getPayload(message, _getSender(message, participants, members));
                }
                var keyCheck = null;
                for (var i = 0; i < participants.length; i++) {
                    var participant = participants[i];
                    if (members.indexOf(participant.id) < 0) {
                        continue;
                    }
                    if (!keyCheck) {
                        keyCheck = participant.cliquesMember.groupKey;
                    } else {
                        assert.strictEqual(participant.cliquesMember.groupKey, keyCheck);
                    }
                    assert.ok(participant.askeMember.isSessionAcknowledged());
                    assert.strictEqual(participant.state, ns.STATE.READY);
                    assert.lengthOf(participant.protocolOutQueue, 0);
                    assert.lengthOf(participant.uiQueue, 0);
                    assert.lengthOf(participant.messageOutQueue, 0);
                }

                console.log('Joining two new at ' + Math.round(Date.now() / 1000 - startTime));
                // Join two new guys.
                var newMembers = ['4', '5'];
                members = members.concat(newMembers);
                for (var i = 0; i < newMembers.length; i++) {
                    var newMember = new ns.ProtocolHandler(newMembers[i],
                                                           _td.ED25519_PRIV_KEY,
                                                           _td.ED25519_PUB_KEY,
                                                           _td.STATIC_PUB_KEY_DIR);
                    participants.push(newMember);
                }

                // '2' starts upflow for join.
                participants[1].join(newMembers);
                message = participants[1].protocolOutQueue.shift();
                payload = _getPayload(message, _getSender(message, participants, members));

                console.log('Upflow for join at ' + Math.round(Date.now() / 1000 - startTime));
                // Upflow for join.
                while (payload.dest !== '') {
                    var nextId = payload.members.indexOf(payload.dest);
                    participants[nextId].processMessage(message);
                    message = participants[nextId].protocolOutQueue.shift();
                    payload = _getPayload(message, _getSender(message, participants, members));
                    if (payload.dest === '') {
                        assert.strictEqual(participants[nextId].state, ns.STATE.AUX_DOWNFLOW);
                    } else {
                        assert.strictEqual(participants[nextId].state, ns.STATE.AUX_UPFLOW);
                    }
                }

                console.log('Downflow for join at ' + Math.round(Date.now() / 1000 - startTime));
                // Downflow for join.
                nextMessages = [];
                while (payload) {
                    for (var i = 0; i < participants.length; i++) {
                        var participant = participants[i];
                        if (members.indexOf(participant.id) < 0) {
                            continue;
                        }
                        participant.processMessage(message);
                        var nextMessage = participant.protocolOutQueue.shift();
                        if (nextMessage) {
                            nextMessages.push(utils.clone(nextMessage));
                        }
                        if (participant.askeMember.isSessionAcknowledged()) {
                            assert.strictEqual(participant.state, ns.STATE.READY);
                        } else {
                            assert.strictEqual(participant.state, ns.STATE.AUX_DOWNFLOW);
                        }
                        assert.deepEqual(participant.cliquesMember.members, members);
                        assert.deepEqual(participant.askeMember.members, members);
                    }
                    message = nextMessages.shift();
                    payload = _getPayload(message, _getSender(message, participants, members));
                }
                keyCheck = null;
                for (var i = 0; i < participants.length; i++) {
                    var participant = participants[i];
                    if (members.indexOf(participant.id) < 0) {
                        continue;
                    }
                    if (!keyCheck) {
                        keyCheck = participant.cliquesMember.groupKey;
                    } else {
                        assert.strictEqual(participant.cliquesMember.groupKey, keyCheck);
                    }
                    assert.ok(participant.askeMember.isSessionAcknowledged());
                    assert.strictEqual(participant.state, ns.STATE.READY);
                    assert.lengthOf(participant.protocolOutQueue, 0);
                    assert.lengthOf(participant.uiQueue, 0);
                    assert.lengthOf(participant.messageOutQueue, 0);
                }

                console.log('Excluding two at ' + Math.round(Date.now() / 1000 - startTime));
                // '4' excludes two members.
                var toExclude = ['1', '3'];
                for (var i = 0; i < toExclude.length; i++) {
                    var delIndex = members.indexOf(toExclude[i]);
                    members.splice(delIndex, 1);
                    participants.splice(delIndex, 1);
                }
                participants[1].exclude(toExclude);
                message = participants[1].protocolOutQueue.shift();
                payload = _getPayload(message, _getSender(message, participants, members));
                members = payload.members;

                console.log('Downflow for exclude at ' + Math.round(Date.now() / 1000 - startTime));
                // Downflow for exclude.
                nextMessages = [];
                while (payload) {
                    for (var i = 0; i < participants.length; i++) {
                        var participant = participants[i];
                        if (members.indexOf(participant.id) < 0) {
                            continue;
                        }
                        participant.processMessage(message);
                        var nextMessage = participant.protocolOutQueue.shift();
                        if (nextMessage) {
                            nextMessages.push(utils.clone(nextMessage));
                        }
                        if (participant.askeMember.isSessionAcknowledged()) {
                            assert.strictEqual(participant.state, ns.STATE.READY);
                        } else {
                            assert.strictEqual(participant.state, ns.STATE.AUX_DOWNFLOW);
                        }
                        assert.deepEqual(participant.cliquesMember.members, members);
                        assert.deepEqual(participant.askeMember.members, members);
                    }
                    message = nextMessages.shift();
                    payload = _getPayload(message, _getSender(message, participants, members));
                }
                keyCheck = null;
                for (var i = 0; i < participants.length; i++) {
                    var participant = participants[i];
                    if (members.indexOf(participant.id) < 0) {
                        continue;
                    }
                    if (!keyCheck) {
                        keyCheck = participant.cliquesMember.groupKey;
                    } else {
                        assert.strictEqual(participant.cliquesMember.groupKey, keyCheck);
                    }
                    assert.ok(participant.askeMember.isSessionAcknowledged());
                    assert.strictEqual(participant.state, ns.STATE.READY);
                    assert.lengthOf(participant.protocolOutQueue, 0);
                    assert.lengthOf(participant.uiQueue, 0);
                    assert.lengthOf(participant.messageOutQueue, 0);
                }

                console.log('Messaging at ' + Math.round(Date.now() / 1000 - startTime));
                // '5' sends a confidential text message to the group.
                participants[2].send('Rock me Amadeus');
                message = participants[2].messageOutQueue.shift();

                // Received message for all.
                for (var i = 0; i < participants.length; i++) {
                    var participant = participants[i];
                    if (members.indexOf(participant.id) < 0) {
                        continue;
                    }
                    var messageClone = utils.clone(message);
                    participant.processMessage(messageClone);
                    var uiMessage = participant.uiQueue.shift();
                    assert.strictEqual(uiMessage.message, 'Rock me Amadeus');
                    assert.strictEqual(uiMessage.type, 'message');
                    assert.strictEqual(uiMessage.from, '5');
                }

                console.log('Refreshing at ' + Math.round(Date.now() / 1000 - startTime));
                // '2' initiates a key refresh.
                var oldGroupKey = participants[0].cliquesMember.groupKey;
                var oldPrivKey = participants[0].cliquesMember.privKey;
                participants[0].refresh();
                message = participants[0].protocolOutQueue.shift();
                payload = _getPayload(message, _getSender(message, participants, members));
                assert.notStrictEqual(participants[0].cliquesMember.privKey, oldPrivKey);
                assert.notStrictEqual(participants[0].cliquesMember.groupKey, oldGroupKey);

                console.log('Downflow for refresh at ' + Math.round(Date.now() / 1000 - startTime));
                // Downflow for refresh.
                nextMessages = [];
                while (payload) {
                    for (var i = 0; i < participants.length; i++) {
                        var participant = participants[i];
                        if (members.indexOf(participant.id) < 0) {
                            continue;
                        }
                        oldPrivKey = participant.cliquesMember.privKey;
                        participant.processMessage(message);
                        var nextMessage = participant.protocolOutQueue.shift();
                        if (nextMessage) {
                            nextMessages.push(utils.clone(nextMessage));
                        }
                        if (participant.askeMember.isSessionAcknowledged()) {
                            assert.strictEqual(participant.state, ns.STATE.READY);
                        } else {
                            assert.strictEqual(participant.state, ns.STATE.AUX_DOWNFLOW);
                        }
                        assert.deepEqual(participant.cliquesMember.members, members);
                        assert.deepEqual(participant.askeMember.members, members);
                    }
                    message = nextMessages.shift();
                    payload = _getPayload(message, _getSender(message, participants, members));
                }
                keyCheck = null;
                for (var i = 0; i < participants.length; i++) {
                    var participant = participants[i];
                    if (members.indexOf(participant.id) < 0) {
                        continue;
                    }
                    if (!keyCheck) {
                        keyCheck = participant.cliquesMember.groupKey;
                    } else {
                        assert.strictEqual(participant.cliquesMember.groupKey, keyCheck);
                    }
                    assert.notStrictEqual(participant.cliquesMember.groupKey, oldGroupKey);
                    assert.ok(participant.askeMember.isSessionAcknowledged());
                    assert.strictEqual(participant.state, ns.STATE.READY);
                    assert.lengthOf(participant.protocolOutQueue, 0);
                    assert.lengthOf(participant.uiQueue, 0);
                    assert.lengthOf(participant.messageOutQueue, 0);
                }

                console.log('Recovering at ' + Math.round(Date.now() / 1000 - startTime));
                // '5' starts a glitch recovery.
                participants[2].state = ns.STATE.AUX_UPFLOW; // The glitch, where things got stuck.
                oldGroupKey = participants[2].cliquesMember.groupKey;
                oldPrivKey = participants[2].cliquesMember.privKey;
                var oldSigningKey = participants[2].askeMember.ephemeralPrivKey;
                // Should do a fullRefresh()
                participants[2].recover();
                assert.strictEqual(participants[2].recovering, true);
                message = participants[2].protocolOutQueue.shift();
                payload = _getPayload(message, _getSender(message, participants, members));
                assert.notStrictEqual(participants[2].cliquesMember.privKey, oldPrivKey);
                assert.strictEqual(participants[2].askeMember.ephemeralPrivKey, oldSigningKey);
                // Sort participants.
                var tempParticipants = [];
                for (var i = 0; i < payload.members.length; i++) {
                    var index = members.indexOf(payload.members[i]);
                    tempParticipants.push(participants[index]);
                }
                participants = tempParticipants;
                members = payload.members;

                console.log('Upflow for recover at ' + Math.round(Date.now() / 1000 - startTime));
                // Upflow for recovery.
                while (payload.dest !== '') {
                    var nextId = payload.members.indexOf(payload.dest);
                    oldSigningKey = participants[nextId].askeMember.ephemeralPrivKey;
                    participants[nextId].processMessage(message);
                    assert.strictEqual(participants[nextId].recovering, true);
                    assert.strictEqual(participants[nextId].askeMember.ephemeralPrivKey, oldSigningKey);
                    message = participants[nextId].protocolOutQueue.shift();
                    payload = _getPayload(message, _getSender(message, participants, members));
                    if (payload.dest === '') {
                        assert.strictEqual(participants[nextId].state, ns.STATE.INIT_DOWNFLOW);
                    } else {
                        assert.strictEqual(participants[nextId].state, ns.STATE.INIT_UPFLOW);
                    }
                }

                console.log('Downflow for recover at ' + Math.round(Date.now() / 1000 - startTime));
                // Downflow for recovery.
                nextMessages = [];
                while (payload) {
                    for (var i = 0; i < participants.length; i++) {
                        var participant = participants[i];
                        if (members.indexOf(participant.id) < 0) {
                            continue;
                        }
                        participant.processMessage(message);
                        var nextMessage = participant.protocolOutQueue.shift();
                        if (nextMessage) {
                            nextMessages.push(utils.clone(nextMessage));
                        }
                        if (participant.askeMember.isSessionAcknowledged()) {
                            assert.strictEqual(participant.state, ns.STATE.READY);
                            assert.strictEqual(participant.recovering, false);
                        } else {
                            assert.strictEqual(participant.state, ns.STATE.INIT_DOWNFLOW);
                            assert.strictEqual(participant.recovering, true);
                        }
                        assert.deepEqual(participant.cliquesMember.members, members);
                        assert.deepEqual(participant.askeMember.members, members);
                    }
                    message = nextMessages.shift();
                    payload = _getPayload(message, _getSender(message, participants, members));
                }
                keyCheck = null;
                for (var i = 0; i < participants.length; i++) {
                    var participant = participants[i];
                    if (members.indexOf(participant.id) < 0) {
                        continue;
                    }
                    if (!keyCheck) {
                        keyCheck = participant.cliquesMember.groupKey;
                    } else {
                        assert.strictEqual(participant.cliquesMember.groupKey, keyCheck);
                    }
                    assert.ok(participant.askeMember.isSessionAcknowledged());
                    assert.strictEqual(participant.state, ns.STATE.READY);
                    assert.lengthOf(participant.protocolOutQueue, 0);
                    assert.lengthOf(participant.uiQueue, 0);
                    assert.lengthOf(participant.messageOutQueue, 0);
                    assert.notStrictEqual(participant.cliquesMember.groupKey, oldGroupKey);
                }
            });

            it('whole flow for two initiated by plain text message, quit', function() {
                // Extend timeout, this test takes longer.
                this.timeout(20000);
                var numMembers = 2;
                var members = [];
                var participants = [];
                for (var i = 1; i <= numMembers; i++) {
                    members.push(i.toString());
                    var newMember = new ns.ProtocolHandler(i.toString(),
                                                           _td.ED25519_PRIV_KEY,
                                                           _td.ED25519_PUB_KEY,
                                                           _td.STATIC_PUB_KEY_DIR);
                    participants.push(newMember);
                }
                var message = {message: 'Kia ora', from: '1', to: '2'};
                var payload = null;

                // Processing plain text message.
                participants[1].processMessage(message);
                message = participants[1].protocolOutQueue.shift();
                assert.strictEqual(message.message.substring(0, 9),
                                   '?mpENCv' + version.PROTOCOL_VERSION.charCodeAt(0) + '?');
                assert.strictEqual(message.from, '2');
                assert.strictEqual(message.to, '1');
                var uiMessage = participants[1].uiQueue.shift();
                assert.strictEqual(uiMessage.type, 'info');
                assert.strictEqual(uiMessage.message, 'Received unencrypted message, requesting encryption.');
                assert.strictEqual(participants[1].state, ns.STATE.NULL);

                // Process mpENC query response.
                participants[0].processMessage(message);
                message = participants[0].protocolOutQueue.shift();
                payload = _getPayload(message, participants[0]);
                assert.strictEqual(payload.source, '1');
                assert.strictEqual(payload.dest, '2');
                assert.strictEqual(payload.messageType, codec.MESSAGE_TYPE.INIT_INITIATOR_UP);
                assert.strictEqual(participants[0].state, ns.STATE.INIT_UPFLOW);

                // Process key agreement upflow.
                participants[1].processMessage(message);
                message = participants[1].protocolOutQueue.shift();
                payload = _getPayload(message, participants[1]);
                assert.strictEqual(payload.source, '2');
                assert.strictEqual(payload.dest, '');
                assert.strictEqual(payload.messageType, codec.MESSAGE_TYPE.INIT_PARTICIPANT_DOWN);
                assert.strictEqual(participants[1].state, ns.STATE.INIT_DOWNFLOW);

                // Downflow for both.
                var nextMessages = [];
                while (payload) {
                    for (var i = 0; i < participants.length; i++) {
                        var participant = participants[i];
                        if (members.indexOf(participant.id) < 0) {
                            continue;
                        }
                        participant.processMessage(message);
                        var nextMessage = participant.protocolOutQueue.shift();
                        if (nextMessage) {
                            nextMessages.push(utils.clone(nextMessage));
                        }
                        if (participant.askeMember.isSessionAcknowledged()) {
                            assert.strictEqual(participant.state, ns.STATE.READY);
                        } else {
                            assert.strictEqual(participant.state, ns.STATE.INIT_DOWNFLOW);
                        }
                        assert.deepEqual(participant.cliquesMember.members, members);
                        assert.deepEqual(participant.askeMember.members, members);
                    }
                    message = nextMessages.shift();
                    payload = _getPayload(message, _getSender(message, participants, members));
                }
                var keyCheck = null;
                for (var i = 0; i < participants.length; i++) {
                    var participant = participants[i];
                    if (members.indexOf(participant.id) < 0) {
                        continue;
                    }
                    if (!keyCheck) {
                        keyCheck = participant.cliquesMember.groupKey;
                    } else {
                        assert.strictEqual(participant.cliquesMember.groupKey, keyCheck);
                    }
                    assert.ok(participant.askeMember.isSessionAcknowledged());
                    assert.strictEqual(participant.state, ns.STATE.READY);
                    assert.lengthOf(participant.protocolOutQueue, 0);
                    assert.lengthOf(participant.uiQueue, 0);
                    assert.lengthOf(participant.messageOutQueue, 0);
                }

                // '2' quits participation.
                participants[1].quit();
                message = participants[1].protocolOutQueue.shift();
                payload = _getPayload(message, _getSender(message, participants, members));

                // Downflow for quit.
                nextMessages = [];
                while (payload) {
                    for (var i = 0; i < participants.length; i++) {
                        var participant = participants[i];
                        if (members.indexOf(participant.id) < 0) {
                            continue;
                        }
                        participant.processMessage(message);
                        var nextMessage = participant.protocolOutQueue.shift();
                        if (nextMessage) {
                            nextMessages.push(utils.clone(nextMessage));
                        }
                        if (participant.id === '2') {
                            assert.strictEqual(participant.state, ns.STATE.QUIT);
                            assert.deepEqual(participant.cliquesMember.members, ['1']);
                            assert.deepEqual(participant.askeMember.members, ['1']);
                        } else {
                            assert.strictEqual(participant.state, ns.STATE.READY);
                            assert.deepEqual(participant.cliquesMember.members, members);
                            assert.deepEqual(participant.askeMember.members, members);
                        }
                    }
                    message = nextMessages.shift();
                    payload = _getPayload(message, _getSender(message, participants, members));
                }

                // '1' Now invokes the exclude() for a member who has invoked QUIT.
                // This results (by the last-man-standing principle) in a QUIT message by '1' as well.
                participants[0].exclude(['2']);
                message = participants[0].protocolOutQueue.shift();
                payload = _getPayload(message, _getSender(message, participants, members));
                assert.strictEqual(participants[0].state, ns.STATE.QUIT);
                assert.strictEqual(message.messageType, codec.MESSAGE_TYPE.QUIT);
            });
        });

        it('flow with delayed message arrival on initialisation', function() {
            // Initialise members.
            var numMembers = 2;
            var participants = {};
            for (var i = 1; i <= numMembers; i++) {
                participants[i.toString()] = new ns.ProtocolHandler(i.toString(),
                                                                    _td.ED25519_PRIV_KEY,
                                                                    _td.ED25519_PUB_KEY,
                                                                    _td.STATIC_PUB_KEY_DIR);
            }

            // Start.
            participants['1'].start(['2']);
            var protocolMessage = participants['1'].protocolOutQueue.shift();
            assert.strictEqual(participants['1'].state, ns.STATE.INIT_UPFLOW);

            // Processing start/upflow message.
            participants['2'].processMessage(protocolMessage);
            protocolMessage = participants['2'].protocolOutQueue.shift();
            assert.strictEqual(participants['2'].state, ns.STATE.INIT_DOWNFLOW);

            // Process first downflow message.
            participants['1'].processMessage(protocolMessage);
            protocolMessage = participants['1'].protocolOutQueue.shift();
            assert.strictEqual(participants['1'].state, ns.STATE.READY);

            // Final downflow for '2' is still missing ...
            // ... but '1' is already sending.
            participants['1'].send("Harry, fahr' schon mal den Wagen vor!");
            var dataMessage = participants['1'].messageOutQueue.shift();

            // Now '2' is receiving before being ready.
            assert.throws(function() { participants['2'].processMessage(dataMessage); },
                          'Data messages can only be decrypted from a ready state.');
        });

        it('out of order flow by callbacks triggered before state is READY (bug 283)', function() {
            // Initialise members.
            var numMembers = 2;
            var participants = {};
            for (var i = 1; i <= numMembers; i++) {
                participants[i.toString()] = new ns.ProtocolHandler(i.toString(),
                                                                    _td.ED25519_PRIV_KEY,
                                                                    _td.ED25519_PUB_KEY,
                                                                    _td.STATIC_PUB_KEY_DIR);
            }

            // Start.
            participants['1'].start(['2']);
            var protocolMessage = participants['1'].protocolOutQueue.shift();
            assert.strictEqual(participants['1'].state, ns.STATE.INIT_UPFLOW);

            // Processing start/upflow message.
            participants['2'].processMessage(protocolMessage);
            protocolMessage = participants['2'].protocolOutQueue.shift();
            assert.strictEqual(participants['2'].state, ns.STATE.INIT_DOWNFLOW);

            // This 'stateUpdatedCallback' will add a assert() to ensure that
            // the .state is set to READY, after the protocolOutQueue got
            // a new message added (not before!)
            participants['1'].stateUpdatedCallback = function(h) {
                if(this.state === ns.STATE.READY) {
                    assert.strictEqual(participants['1'].protocolOutQueue.length, 1);
                }
            };

            // Now process the first downflow message.
            // This will also trigger the .statusUpdateCallback, which will
            // guarantee that .protocolOutQueue contains exactly 1 message in
            // the queue.
            participants['1'].processMessage(protocolMessage);
            protocolMessage = participants['1'].protocolOutQueue.shift();
            assert.strictEqual(participants['1'].state, ns.STATE.READY);
            // We don't need this check anymore, let's remove it.
            participants['1'].stateUpdatedCallback = function(h) {};

            // Participant 2 should process the new protocolOut message.
            participants['2'].processMessage(protocolMessage);
            // Participant 2 is also ready.
            assert.strictEqual(participants['2'].state, ns.STATE.READY);

            // This was the problematic part:
            // 1 (room owner, who started the flow) sees he is in READY
            // state, so he tries to send a message to 2, meanwhile 2 is still
            // not ready, yet.

            // Note: the correct state/protocolOutQueue is now verified with
            //       the .statusUpdateCallback callback (see above).

            // Test message sending: jid1 -> jid2
            participants['1'].send("How you doin'?", {});

            participants['2'].processMessage(
                participants['1'].messageOutQueue.shift()
            );

            assert.strictEqual(participants['2'].uiQueue[0].message, "How you doin'?");
            assert.strictEqual(participants['2'].uiQueue[0].from, "1");
            assert.strictEqual(participants['2'].uiQueue[0].type, "message");
        });
    });
});
