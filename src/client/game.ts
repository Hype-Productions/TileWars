import * as Phaser from 'phaser';
import { AUTO, Game } from 'phaser';
import { PatternGame } from './scenes/PatternGame';
import { VersusGame } from './scenes/VersusGame';
import { VersusLobby } from './scenes/VersusLobby';
import { VersusResult } from './scenes/VersusResult';
import { installHighDensityRendering } from './phaserDisplay';
import {
  consumeVersusInviteIntent,
  readVersusShareData,
} from './versusShare';

//  Find out more information about the Game Config at:
//  https://docs.phaser.io/api-documentation/typedef/types-core#gameconfig
const config: Phaser.Types.Core.GameConfig = {
  type: AUTO,
  parent: 'game-container',
  backgroundColor: '#f6f0e8',
  antialias: true,
  antialiasGL: true,
  roundPixels: true,
  scale: {
    // Keep a fixed game resolution but automatically scale it to fit within the available
    // web-view / device while maintaining aspect ratio.
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 1024,
    height: 768,
  },
  scene: [PatternGame, VersusLobby, VersusGame, VersusResult],
};

const StartGame = (parent: string) => {
  const inviteIntent = consumeVersusInviteIntent();
  const shared = inviteIntent ?? readVersusShareData();
  const startMode =
    document.body.dataset.startMode === 'versus' ? 'versus' : 'daily';
  return new Game({
    ...config,
    parent,
    callbacks: {
      preBoot: (game) => {
        if (shared) {
          game.registry.set('sharedInviteId', shared.inviteId);
        }
        if (inviteIntent?.action === 'accept') {
          game.registry.set('acceptSharedInvite', true);
        }
        game.registry.set('startMode', startMode);
      },
      postBoot: (game) => {
        installHighDensityRendering(game);
      },
    },
  });
};

document.addEventListener('DOMContentLoaded', () => {
  StartGame('game-container');
});
