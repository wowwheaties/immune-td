window.Lives = {
  START: 5,
  _lives: 0,

  reset: function(n) {
    this._lives = (typeof n === 'number') ? n : this.START;
  },
  get: function() { return this._lives; },
  lose: function(n) { this._lives = Math.max(0, this._lives - n); }
};
