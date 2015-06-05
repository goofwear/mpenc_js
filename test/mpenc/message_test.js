/**
 * @fileOverview
 * Test of the `mpenc/codec` module.
 */

/*
 * Created: 19 Mar 2014 Guy K. Kloss <gk@mega.co.nz>
 *
 * (c) 2014-2015 by Mega Limited, Auckland, New Zealand
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
    "mpenc/message",
    "mpenc/codec",
    "mpenc/helper/struct",
    "mpenc/helper/utils",
    "jodid25519",
    "asmcrypto",
    "megalogger",
    "chai",
    "sinon/sandbox",
    "sinon/assert",
], function(ns, codec, struct, utils, jodid25519, asmCrypto, MegaLogger,
            chai, sinon_sandbox) {
    "use strict";

    var assert = chai.assert;

    // Create/restore Sinon stub/spy/mock sandboxes.
    var sandbox = null;

    beforeEach(function() {
        sandbox = sinon_sandbox.create();
    });

    afterEach(function() {
        sandbox.restore();
    });

    function _dummySessionKeyStore() {
        var sessionKeyStore = { sessionIDs: [_td.SESSION_ID],
                                sessions: {} };
        sessionKeyStore.sessions[_td.SESSION_ID] = {
            sid: _td.SESSION_ID,
            members: ['Moe', 'Larry', 'Curly'],
            groupKeys: [_td.GROUP_KEY]
        };
        return sessionKeyStore;
    }

    var defaultRecipients = new struct.ImmutableSet(['Larry', 'Curly']);

    describe("DefaultMessageCodec", function() {
        var codec = ns.DefaultMessageCodec;
        var assertEncodeDecode = function(body) {
            assert.deepEqual(body, codec.decode(codec.encode(body)));
        };

        it("encode-decode", function() {
            assertEncodeDecode(new ns.Payload("hello"));
            assertEncodeDecode(new ns.ExplicitAck(true));
            assertEncodeDecode(new ns.ExplicitAck(false));
            assertEncodeDecode(new ns.Consistency(true));
            assertEncodeDecode(new ns.Consistency(false));
        });

        it("encode fail", function() {
            assert.throws(codec.encode.bind(null, null));
            assert.throws(codec.encode.bind(null, undefined));
            assert.throws(codec.encode.bind(null, new ns.Message("", [], "", [], new ns.Payload("x"))));
            assert.throws(codec.encode.bind(null, {}));
            assert.throws(codec.encode.bind(null, []));
        });

        it("decode fail", function() {
            assert.throws(codec.decode.bind(null, null));
            assert.throws(codec.decode.bind(null, ""));
            assert.throws(codec.decode.bind(null, '[]'));
            assert.throws(codec.decode.bind(null, '\x00{}'));
            assert.throws(codec.decode.bind(null, '\xff[""]'));
            // specific values
            assert.throws(codec.decode.bind(null, '\x00[]'));
            assert.throws(codec.decode.bind(null, '\x00[123]'));
            assert.throws(codec.decode.bind(null, '\x00[false]'));
            assert.throws(codec.decode.bind(null, '\x01[]'));
            assert.throws(codec.decode.bind(null, '\x01[123]'));
            assert.throws(codec.decode.bind(null, '\x01["x"]'));
            assert.throws(codec.decode.bind(null, '\x03[]'));
            assert.throws(codec.decode.bind(null, '\x03[123]'));
            assert.throws(codec.decode.bind(null, '\x03["x"]'));
        });

    });


    describe("MessageSecurity.encrypt()", function() {
        it('data message', function() {
            var sessionKeyStore = _dummySessionKeyStore();
            var result = new ns.MessageSecurity('Moe',
                                                _td.ED25519_PRIV_KEY,
                                                _td.ED25519_PUB_KEY,
                                                sessionKeyStore).encrypt('foo', defaultRecipients);
            // sid/key hint (4 + 1), signature (4 + 64), protocol v (4 + 1),
            // msg. type (4 + 1), IV (4 + 12), encr. message (4 + (4 + 5))
            assert.lengthOf(result.ciphertext, 112);
        });

        it('data message with second group key', function() {
            var sessionKeyStore = _dummySessionKeyStore();
            sessionKeyStore.sessionIDs.push('foo');
            sessionKeyStore.sessions['foo'] = {};
            sessionKeyStore.sessions[_td.SESSION_ID].groupKeys.push('foo');
            var result = new ns.MessageSecurity('Moe',
                _td.ED25519_PRIV_KEY, _td.ED25519_PUB_KEY, sessionKeyStore
                ).encrypt('foo', defaultRecipients);
            // sid/key hint (4 + 1), signature (4 + 64), protocol v (4 + 1),
            // msg. type (4 + 1), IV (4 + 12), encr. message (4 + (4 + 5))
            assert.lengthOf(result.ciphertext, 112);
        });

        it('data message with exponential padding', function() {
            var sessionKeyStore = _dummySessionKeyStore();
            var result = new ns.MessageSecurity('Moe',
                _td.ED25519_PRIV_KEY, _td.ED25519_PUB_KEY, sessionKeyStore
                ).encrypt('foo', defaultRecipients, null, 32);
            // sid/key hint (4 + 1), signature (4 + 64), protocol v (4 + 1),
            // msg. type (4 + 1), IV (4 + 12), encr. message (4 + 32)
            assert.lengthOf(result.ciphertext, 135);
        });

        it('data message with parents', function() {
            var sessionKeyStore = _dummySessionKeyStore();
            var result = new ns.MessageSecurity('Moe',
                _td.ED25519_PRIV_KEY, _td.ED25519_PUB_KEY, sessionKeyStore
                ).encrypt('foo', defaultRecipients, new struct.ImmutableSet(["abcd", "1234"]));
            // sid/key hint (4 + 1), signature (4 + 64), protocol v (4 + 1),
            // msg. type (4 + 1), IV (4 + 12), encr. message (4 + (4 + 5 + parents (4 + 4) * 2))
            assert.lengthOf(result.ciphertext, 128);
        });

        it('data message with parents and padding', function() {
            var sessionKeyStore = _dummySessionKeyStore();
            var result = new ns.MessageSecurity('Moe',
                _td.ED25519_PRIV_KEY, _td.ED25519_PUB_KEY, sessionKeyStore
                ).encrypt('foo', defaultRecipients, new struct.ImmutableSet(["abcd", "1234"]), 32);
            // sid/key hint (4 + 1), signature (4 + 64), protocol v (4 + 1),
            // msg. type (4 + 1), IV (4 + 12), encr. message (4 + 32)
            assert.lengthOf(result.ciphertext, 135);
        });
    });

    describe("MessageSecurity.decrypt()", function() {
        it('data message', function() {
            var sessionKeyStore = _dummySessionKeyStore();
            sessionKeyStore.pubKeyMap = {'Moe': _td.ED25519_PUB_KEY };
            var result = new ns.MessageSecurity('Moe', null, null, sessionKeyStore
                ).decrypt(_td.DATA_MESSAGE_STRING, 'Moe');

            assert.strictEqual(result.author, 'Moe');
            assert.strictEqual(result.body.content, _td.DATA_MESSAGE_CONTENT.data);
        });

        it('data message with second group key', function() {
            var sessionKeyStore = _dummySessionKeyStore();
            sessionKeyStore.sessionIDs.push('foo');
            sessionKeyStore.sessions['foo'] = {};
            sessionKeyStore.sessions[_td.SESSION_ID].groupKeys.push('foo');
            sessionKeyStore.pubKeyMap = {'Moe': _td.ED25519_PUB_KEY };
            var result = new ns.MessageSecurity('Moe', null, null, sessionKeyStore
                ).decrypt(_td.DATA_MESSAGE_STRING2, 'Moe');

            assert.strictEqual(result.author, 'Moe');
            assert.strictEqual(result.body.content, _td.DATA_MESSAGE_CONTENT.data);
        });

        it('data message, debug on', function() {
            sandbox.stub(MegaLogger._logRegistry.codec, '_log');
            sandbox.stub(MegaLogger._logRegistry.message, '_log');

            var sessionKeyStore = _dummySessionKeyStore();
            sessionKeyStore.sessionIDs.push('foo');
            sessionKeyStore.sessions['foo'] = {};
            sessionKeyStore.sessions[_td.SESSION_ID].groupKeys.push('foo');
            sessionKeyStore.pubKeyMap = {'Moe': _td.ED25519_PUB_KEY };

            var result = new ns.MessageSecurity('Moe', null, null, sessionKeyStore
                ).decrypt(_td.DATA_MESSAGE_STRING, 'Moe');

            var log = MegaLogger._logRegistry.message._log.getCall(0).args;
            assert.deepEqual(log, [0, ['mpENC decoded message debug: ',
                                       ['protocol: 1',
                                        'messageType: 0x3 (MPENC_DATA_MESSAGE)',
                                        'messageIV: evs2iGlNE8kspMvZ',
                                        'rawDataMessage: jBDsQxp66K9e']]]);
            log = MegaLogger._logRegistry.message._log.getCall(1).args;
            assert.deepEqual(log, [0, ['mpENC decrypted message debug: ',
                                       ['body: foo']]]);
        });

        it('data message with exponential padding', function() {
            var sessionKeyStore = _dummySessionKeyStore();
            sessionKeyStore.pubKeyMap = {'Moe': _td.ED25519_PUB_KEY };

            var result = new ns.MessageSecurity('Moe', null, null, sessionKeyStore
                ).decrypt(_td.DATA_MESSAGE_STRING32, 'Moe');

            assert.strictEqual(result.author, 'Moe');
            assert.strictEqual(result.body.content, _td.DATA_MESSAGE_CONTENT.data);
        });
    });

    describe("encrypt-decrypt with arbitrary unicode text", function() {
        var tests = ['42', "Don't panic!", 'Flying Spaghetti Monster',
                     "Ph'nglui mglw'nafh Cthulhu R'lyeh wgah'nagl fhtagn",
                     'Tēnā koe', 'Hänsel & Gretel', 'Слартибартфаст'];

        it('data messages', function() {
            this.timeout(this.timeout() * 2);
            for (var i = 0; i < tests.length; i++) {
                var sessionKeyStore = _dummySessionKeyStore();
                sessionKeyStore.sessionIDs.push('foo');
                sessionKeyStore.sessions['foo'] = {};
                sessionKeyStore.sessions[_td.SESSION_ID].groupKeys.push('foo');
                sessionKeyStore.pubKeyMap = {'Moe': _td.ED25519_PUB_KEY };
                var mSecurity = new ns.MessageSecurity('Moe',
                                                       _td.ED25519_PRIV_KEY,
                                                       _td.ED25519_PUB_KEY,
                                                       sessionKeyStore);

                var encrypted = mSecurity.encrypt(tests[i], defaultRecipients).ciphertext;
                var result = mSecurity.decrypt(encrypted, 'Moe');
                assert.strictEqual(result.author, 'Moe');
                assert.strictEqual(result.body.content, tests[i]);
            }
        });

        it('data messages with exponential padding', function() {
            this.timeout(this.timeout() * 2);
            for (var i = 0; i < tests.length; i++) {
                var sessionKeyStore = _dummySessionKeyStore();
                sessionKeyStore.sessionIDs.push('foo');
                sessionKeyStore.sessions['foo'] = {};
                sessionKeyStore.sessions[_td.SESSION_ID].groupKeys.push('foo');
                sessionKeyStore.pubKeyMap = {'Moe': _td.ED25519_PUB_KEY };
                var mSecurity = new ns.MessageSecurity('Moe',
                                                       _td.ED25519_PRIV_KEY,
                                                       _td.ED25519_PUB_KEY,
                                                       sessionKeyStore);

                var encrypted = mSecurity.encrypt(tests[i], defaultRecipients, null, 32).ciphertext;
                var result = mSecurity.decrypt(encrypted, 'Moe');
                assert.strictEqual(result.author, 'Moe');
                assert.strictEqual(result.body.content, tests[i]);
                assert(encrypted.length === 135 || encrypted.length === 135 + 32);
            }
        });
    });

    describe("_encryptRaw()/_decryptRaw()", function() {
        it('several round trips', function() {
            for (var i = 0; i < 5; i++) {
                var key = jodid25519.utils.bytes2string(utils._newKey08(128));
                var messageLength = Math.floor(256 * Math.random());
                var message = _tu.cheapRandomString(messageLength);
                var encryptResult = ns._encryptRaw(message, key);
                var cipher = encryptResult.data;
                var iv = encryptResult.iv;
                var clear = ns._decryptRaw(cipher, key, iv);
                assert.strictEqual(message, clear);
            }
        });
    });

});
