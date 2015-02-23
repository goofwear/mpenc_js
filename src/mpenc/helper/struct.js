/**
 * @fileOverview
 * Data structures.
 */

define([
    "mpenc/helper/utils",
    "es6-collections",
    "megalogger",
], function(utils, es6_shim, MegaLogger) {
    "use strict";

    /**
     * @exports mpenc/helper/struct
     * Data structures.
     *
     * @description
     * Data structures.
     */
    var ns = {};

    /*
     * Created: 28 Mar 2014-2015 Ximin Luo <xl@mega.co.nz>
     * Contributions: Guy Kloss <gk@mega.co.nz>
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

    var logger = MegaLogger.getLogger('struct', undefined, 'helper');

    /**
     * 3-arg function to iterate over a Collection
     * @callback forEachCallback
     * @param key {} In the case of Set, this is the same as the value.
     * @param value {}
     * @param collection {}
     */

    /**
     * Wrapper around a "get()"-capable object (e.g. Map) that throws
     * <code>ReferenceError</code> when the result is <code>undefined</code>.
     */
    var safeGet = function(gettable, key) {
        var result = gettable.get(key);
        if (result === undefined) {
            throw new ReferenceError("invalid key: " + key);
        }
        return result;
    };
    ns.safeGet = safeGet;

    /**
     * Apply a function to an ES6 iterator, ignoring its "return value".
     *
     * @param iter {Iterator} Iterator to run through.
     * @param func {function} 1-arg function to apply to each element.
     * @memberOf! module:mpenc/helper/struct
     */
    var iteratorForEach = function(iter, func) {
        // work around https://github.com/WebReflection/es6-collections/issues/22
        if (iter instanceof Array) return iter.forEach(func);
        var done = false;
        while (!done) {
            var result = iter.next();
            done = result.done;
            if (!done) {
                func(result.value);
            } else {
                return result.value;
            }
        }
    };
    ns.iteratorForEach = iteratorForEach;

    /**
     * Populate an array using an ES6 iterator, ignoring its "return value".
     *
     * @param iter {Iterator} Iterator to run through.
     * @returns {Array} Yielded values of the iterator.
     * @memberOf! module:mpenc/helper/struct
     */
    var iteratorToArray = function(iter) {
        var a = [];
        iteratorForEach(iter, function(v) { a.push(v); });
        return a;
    };
    ns.iteratorToArray = iteratorToArray;

    /**
     * An immutable set, implemented using sorted arrays. Does not scale to
     * massive sizes, but should be adequate for representing (e.g.) members
     * of a chat.
     *
     * <p>Equality in equals() is taken strictly, using <code>===</code>.</p>
     *
     * <p>Use as a <b>factory function</b> as in <code><del>new</del>
     * ImmutableSet([1, 2, 3])</code>.</p>
     *
     * <p>Otherwise, the API is intended to match Facebook's <a
     * href="https://github.com/facebook/immutable-js/">Immutable JS</a>
     * library. We don't use that, because it is 42KB and we only need Set.</p>
     *
     * <p>Equality in equals() is taken strictly, using <code>===</code>. May
     * be used as a factory method, without <code>new</code>.</p>
     *
     * <p>Does not scale to massive sizes, but should be adequate for
     * representing (e.g.) members of a chat.</p>
     *
     * @class
     * @param {...*} ... Elements of the set
     * @memberOf! module:mpenc/helper/struct
     */
    var ImmutableSet = function(iterable) {
        if (!(this instanceof ImmutableSet)) {
            return new ImmutableSet(iterable);
        }

        var items = new Set(iterable);

        // Facebook ImmutableSet provides length
        this.length = items.size;
        this.size = items.size;

        // adhere to the Iterable interface if available
        if (typeof Symbol !== "undefined") {
            // ES6 current standard
            this[Symbol.iterator] = function() {
                return items[Symbol.iterator]();
            };
        } else if ("@@iterator" in items) {
            // at time of writing, Firefox ESR (31) uses an older syntax
            // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/for...of#Browser_compatibility
            this["@@iterator"] = function() {
                return items["@@iterator"]();
            };
        }

        /**
         * Apply a function to every member. The callback is the same as Set.
         * @param callback {forEachCallback} Function to execute for each element.
         * @param thisObj {} Value to use as <code>this</code> when executing <code>callback</code>.
         */
        this.forEach = function(callback, thisObj) {
            return items.forEach(function(v, v0, a) {
                // prevent external access to mutable set
                return callback.call(thisObj, v, v0, this);
            });
        };

        /**
         * Return a Iterator of the elements contained in this set.
         */
        this.values = function() {
            return items.values();
        };

        /**
         * Whether the set contains the given element.
         * @returns {boolean}
         */
        this.has = function(elem) {
            return items.has(elem);
        };
    };

    /**
     * Return a sorted array representation of this set.
     * @returns {Array}
     */
    ImmutableSet.prototype.toArray = function() {
        var a = [];
        this.forEach(function(v) { a.push(v); });
        a.sort();
        return a;
    };

    /**
     * Return a string representation of this set.
     * @returns {string}
     */
    ImmutableSet.prototype.toString = function() {
        return "ImmutableSet(" + this.toArray() + ")";
    };

    /**
     * Return a mutable copy of this set.
     * @returns {Set}
     */
    ImmutableSet.prototype.asMutable = function() {
        return new Set(this);
    };

    /**
     * Return whether this set equals another set.
     * @param {module:mpenc/helper/struct.ImmutableSet} other
     * @returns {boolean}
     */
    ImmutableSet.prototype.equals = function(other) {
        if (!other || other.size !== this.size) {
            return false;
        }
        var eq = true;
        this.forEach(function(v) {
            if (!other.has(v)) {
                eq = false;
            }
        });
        return eq;
    };

    /**
     * Return the disjunction of this and another set, i.e. elements that
     * are in this <b>or</b> the other set.
     * @param {module:mpenc/helper/struct.ImmutableSet} other
     * @returns {module:mpenc/helper/struct.ImmutableSet}
     */
    ImmutableSet.prototype.union = function(other) {
        var union = other.asMutable();
        this.forEach(function(v) {
            union.add(v);
        });
        return ImmutableSet(union);
    };

    /**
     * Return the conjunction of this and another set, i.e. elements that
     * are in this <b>and</b> the other set.
     * @param {module:mpenc/helper/struct.ImmutableSet} other
     * @returns {module:mpenc/helper/struct.ImmutableSet}
     */
    ImmutableSet.prototype.intersect = function(other) {
        var intersection = new Set();
        this.forEach(function(v) {
            if (other.has(v)) {
                intersection.add(v);
            }
        });
        return ImmutableSet(intersection);
    };

    /**
     * Return the difference of this and another set, i.e. elements that
     * are in this <b>and not</b> the other set.
     * @param {module:mpenc/helper/struct.ImmutableSet} other
     * @returns {module:mpenc/helper/struct.ImmutableSet}
     */
    ImmutableSet.prototype.subtract = function(other) {
        var difference = this.asMutable();
        this.forEach(function(v) {
            if (other.has(v)) {
                difference.delete(v);
            }
        });
        return ImmutableSet(difference);
    };

    /**
     * Return what was [added, removed] between this and another set, i.e.
     * same as [other.subtract(this), this.subtract(other)].
     * @param {module:mpenc/helper/struct.ImmutableSet} newer
     * @returns {module:mpenc/helper/struct.ImmutableSet[]}
     */
    ImmutableSet.prototype.diff = function(newer) {
        return [newer.subtract(this), this.subtract(newer)];
    };

    /**
     * Apply a difference to an older set.
     *
     * @param older {module:mpenc/helper/struct.ImmutableSet} Older set
     * @param diff {module:mpenc/helper/struct.ImmutableSet[]} 2-tuple of what to (add, remove).
     * @returns {module:mpenc/helper/struct.ImmutableSet} Newer set
     */
    ImmutableSet.prototype.patch = function(diff) {
        if (!diff || diff[0].intersect(diff[1]).size > 0) {
            throw new Error("invalid diff: " + diff);
        }
        return this.union(diff[0]).subtract(diff[1]);
    };

    /**
     * Do a 3-way merge between this parent set and two child sets.
     * @param {module:mpenc/helper/struct.ImmutableSet} first child
     * @param {module:mpenc/helper/struct.ImmutableSet} other child
     * @returns {module:mpenc/helper/struct.ImmutableSet} Result set
     */
    ImmutableSet.prototype.merge = function(child0, child1) {
        return child1.union(child0.subtract(this)).subtract(this.subtract(child0));
    };

    Object.freeze(ImmutableSet.prototype);
    ns.ImmutableSet = ImmutableSet;


    /**
     * A TrialTarget is an object implementing some interface methods that a
     * {@link TrialBuffer} operates on.
     *
     * @interface
     * @name TrialTarget
     */

    /**
     * This method performs the actual trial.
     *
     * @method TrialTarget#tryMe
     * @param pending {boolean}
     *     Set to `true` if the params are already on the queue (i.e. was seen
     *     before). Note: `false` does not necessarily mean it was *never* seen
     *     before - it may have been dropped since then.
     * @param param {object}
     *     The parameter to test against this trial function.
     * @returns {boolean}
     *     `true` if processing succeeds, otherwise `false`.
     */
    /**
     * This method determines the buffer capacity. It takes no parameters.
     *
     * @method TrialTarget#maxSize
     * @returns {integer}
     *     Number of allowed elements in the buffer.
     */
    /**
     * This method determines a parameter's identifier.
     *
     * @method TrialTarget#paramId
     * @param param {object}
     *     The parameter to find an identifier for.
     * @returns {string}
     *     Identifier that can be used as the key in an {object} to index the
     *     parameters in the buffer, usually a {string}.
     */


    /**
     * A TrialBuffer holds data items ("parameters") that failed to be accepted
     * by a trial function, but that may later be acceptable when newer
     * parameters arrive and are themselves accepted.
     *
     * <p>If the buffer goes above capacity, the oldest item is automatically
     * dropped without being tried again.</p>
     *
     * @constructor
     * @param name {string}
     *     Name for this buffer, useful for debugging.
     * @param target {TrialTarget}
     *     An object satisfying the TrialTarget interface, to apply trials to.
     * @param drop {boolean}
     *     Whether to drop items that overflow the buffer according to
     *     #maxSize, or merely log a warning that the buffer is over
     *     capacity (optional, default: true).
     * @returns {module:mpenc/helper/struct.TrialBuffer}
     * @memberOf! module:mpenc/helper/struct#
     *
     * @property name {string}
     *     Name of trial buffer.
     * @property target {TrialTarget}
     *     An object satisfying the TrialTarget interface, to apply trials to.
     * @property drop {boolean}
     *     Whether to drop parameters beyond the sizing of the buffer.
     */
    var TrialBuffer = function(name, target, drop) {
        this.name = name || '';
        this.target = target;
        if (drop === undefined) {
            this.drop = true;
        } else {
            this.drop = drop;
        }
        this._buffer = {};
        // We're using this following array to keep the order within the items
        // in the buffer.
        this._bufferIDs = [];
    };
    ns.TrialBuffer = TrialBuffer;


    /**
     * Size of trial buffer.
     *
     * @returns {integer}
     */
    TrialBuffer.prototype.length = function() {
        return this._bufferIDs.length;
    };


    /**
     * Try to accept a parameter, stashing it in the buffer if this fails.
     * If it succeeds, also try to accept previously-stashed parameters.
     *
     * @param param {object}
     *     Parameter to be tried.
     * @returns {boolean}
     *     `true` if the processing succeeded.
     */
    TrialBuffer.prototype.trial = function(param) {
        var paramID = this.target.paramId(param);
        var pending = this._buffer.hasOwnProperty(paramID);
        // Remove from buffer, if already there.
        if (pending === true) {
            var olddupe = this._buffer[paramID];
            // Remove entry from _buffer and _paramIDs.
            delete this._buffer[paramID];
            this._bufferIDs.splice(this._bufferIDs.indexOf(paramID), 1);
            var olddupeID = this.target.paramId(param);
            if ((olddupeID !== paramID)
                    || (this._bufferIDs.indexOf(olddupeID) >= 0)) {
                throw new Error('Parameter was not removed from buffer.');
            }
        }

        // Apply `tryMe`.
        if (this.target.tryMe(pending, param)) {
            // This is a bit inefficient when params have a known dependency
            // structure such as in the try-accept buffer; however we think the
            // additional complexity is not worth the minor performance gain.
            // Also, the try-decrypt buffer does not have such structure and
            // there we *have* to brute-force it.
            var hadSuccess;
            while (hadSuccess !== false) {
                hadSuccess = false;
                for (var i in this._bufferIDs) {
                    var itemID = this._bufferIDs[i];
                    var item = this._buffer[itemID];
                    if (this.target.tryMe(false, item)) {
                        delete this._buffer[itemID];
                        this._bufferIDs.splice(this._bufferIDs.indexOf(itemID), 1);
                        logger.debug(this.name + ' unstashed ' + itemID);
                        hadSuccess = true;
                    }
                }
            }
            return true;
        } else {
            var verb = pending ? ' restashed ' : ' stashed ';
            this._buffer[paramID] = param;
            this._bufferIDs.push(paramID);
            logger.debug(this.name + verb + paramID);
            var maxSize = this.target.maxSize();
            if (this._bufferIDs.length > maxSize) {
                if (this.drop) {
                    var droppedID = this._bufferIDs.shift();
                    var dropped = this._buffer[droppedID];
                    delete this._buffer[droppedID];
                    logger.warn(this.name + ' DROPPED ' + droppedID +
                                ' at size ' + maxSize + ', potential data loss.');
                } else {
                    logger.info(this.name + ' is '
                                + (this._bufferIDs.length - maxSize)
                                + ' items over expected capacity.');
                }
            }
            return false;
        }
    };


    return ns;
});
