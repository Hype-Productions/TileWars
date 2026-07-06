import * as Phaser from 'phaser';
import { AUTO, Game } from 'phaser';
import { PatternGame } from './scenes/PatternGame';

//  Find out more information about the Game Config at:
//  https://docs.phaser.io/api-documentation/typedef/types-core#gameconfig
const config: Phaser.Types.Core.GameConfig = {
  type: AUTO,
  parent: 'game-container',
  backgroundColor: '#f6f0e8',
  scale: {
    // Keep a fixed game resolution but automatically scale it to fit within the available
    // web-view / device while maintaining aspect ratio.
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 1024,
    height: 768,
  },
  scene: [PatternGame],
};

const StartGame = (parent: string) => {
  return new Game({ ...config, parent });
};

document.addEventListener('DOMContentLoaded', () => {
  StartGame('game-container');
});
