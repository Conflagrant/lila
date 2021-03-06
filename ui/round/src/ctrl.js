var m = require('mithril');
var throttle = require('lodash-node/modern/functions/throttle');
var chessground = require('chessground');
var partial = chessground.util.partial;
var data = require('./data');
var game = require('game').game;
var ground = require('./ground');
var socket = require('./socket');
var title = require('./title');
var promotion = require('./promotion');
var hold = require('./hold');
var blur = require('./blur');
var init = require('./init');
var blind = require('./blind');
var replayCtrl = require('./replay/ctrl');
var clockCtrl = require('./clock/ctrl');
var correspondenceClockCtrl = require('./correspondenceClock/ctrl');
var moveOn = require('./moveOn');
var atomic = require('./atomic');

module.exports = function(opts) {

  this.data = data({}, opts.data);

  this.vm = {
    flip: false,
    reloading: false,
    redirecting: false
  };

  this.socket = new socket(opts.socketSend, this);

  this.flip = function() {
    this.vm.flip = !this.vm.flip;
    this.chessground.set({
      orientation: this.vm.flip ? this.data.opponent.color : this.data.player.color
    });
  }.bind(this);

  this.setTitle = partial(title.set, this);

  this.sendMove = function(orig, dest, prom) {
    var move = {
      from: orig,
      to: dest
    };
    if (prom) move.promotion = prom;
    if (blur.get()) move.b = 1;
    if (this.clock) move.lag = Math.round(lichess.socket.averageLag);
    this.socket.send('move', move, {
      ackable: true
    });
  }.bind(this);

  var onUserMove = function(orig, dest, meta) {
    hold.register(this.socket, meta.holdTime);
    if (!promotion.start(this, orig, dest, meta.premove)) this.sendMove(orig, dest);
    $.sound.move(this.data.player.color == 'white');
  }.bind(this);

  var onMove = function(orig, dest, captured) {
    if (captured) {
      if (this.data.game.variant.key === 'atomic') atomic.capture(this, dest, captured);
      else $.sound.take();
    }
  }.bind(this);

  this.chessground = ground.make(this.data, opts.data.game.fen, onUserMove, onMove);

  this.apiMove = function(o) {
    m.startComputation();
    if (this.replay.active) this.replay.vm.late = true;
    else this.chessground.apiMove(o.from, o.to);
    if (this.data.game.threefold) this.data.game.threefold = false;
    this.data.game.moves.push(o.san);
    game.setOnGame(this.data, o.color, true);
    m.endComputation();
    if (this.data.player.spectator || o.color != this.data.player.color) $.sound.move(o.color == 'white');
    if (this.data.blind) blind.reload(this);
    if (game.isPlayerPlaying(this.data) && o.color === this.data.player.color) this.moveOn.next();
  }.bind(this);

  this.reload = function(cfg) {
    m.startComputation();
    this.replay.onReload(cfg);
    this.data = data(this.data, cfg);
    makeCorrespondenceClock();
    if (this.clock) this.clock.update(this.data.clock.white, this.data.clock.black);
    if (!this.replay.active) ground.reload(this.chessground, this.data, cfg.game.fen, this.vm.flip);
    this.setTitle();
    if (this.data.blind) blind.reload(this);
    this.moveOn.next();
    setQuietMode();
    m.endComputation();
  }.bind(this);

  this.clock = this.data.clock ? new clockCtrl(
    this.data.clock,
    throttle(partial(this.socket.send, 'outoftime'), this.data.player.spectator ? 1000 : 500), (this.data.simul || this.data.player.spectator || !this.data.pref.clockSound) ? null : this.data.player.color
  ) : false;

  this.isClockRunning = function() {
    return this.data.clock && game.playable(this.data) &&
      ((this.data.game.turns - this.data.game.startedAtTurn) > 1 || this.data.clock.running);
  }.bind(this);

  var clockTick = function() {
    if (this.isClockRunning()) this.clock.tick(this.data.game.player);
  }.bind(this);

  var makeCorrespondenceClock = function() {
    if (this.data.correspondence && !this.correspondenceClock)
      this.correspondenceClock = new correspondenceClockCtrl(
        this.data.correspondence,
        partial(this.socket.send, 'outoftime')
      );
  }.bind(this);
  makeCorrespondenceClock();

  var correspondenceClockTick = function() {
    if (this.correspondenceClock && game.playable(this.data))
      this.correspondenceClock.tick(this.data.game.player);
  }.bind(this);

  if (this.clock) setInterval(clockTick, 100);
  else setInterval(correspondenceClockTick, 1000);

  var setQuietMode = function() {
    lichess.quietMode = game.isPlayerPlaying(this.data) ;
  }.bind(this);
  setQuietMode();

  this.takebackYes = function() {
    this.socket.send('takeback-yes');
    this.chessground.cancelPremove();
  }.bind(this);

  this.moveOn = new moveOn(this, 'lichess.move_on');

  this.replay = new replayCtrl(this);

  this.router = opts.routes;

  this.trans = function(key) {
    var str = opts.i18n[key] || key;
    Array.prototype.slice.call(arguments, 1).forEach(function(arg) {
      str = str.replace('%s', arg);
    });
    return str;
  };

  init(this);
};
