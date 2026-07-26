window.Economy = {
  START: 100,
  PLACE_COST: 50,
  SELL_REFUND: 25,
  SLOW_COST: 75,
  KILL_REWARD: { basic: 5, fast: 8, fungus: 10, parasite: 12, boss: 60 },
  _gold: 0,

  reset: function(n) {
    this._gold = (typeof n === 'number') ? n : this.START;
  },
  getGold: function() { return this._gold; },
  spend: function(n) {
    if (this._gold >= n) {
      this._gold -= n;
      return true;
    }
    return false;
  },
  refund: function(n) { this._gold += n; },

  earn: function(n) { this._gold += n; }
};
