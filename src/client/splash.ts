import { requestExpandedMode } from '@devvit/web/client';

const startButton = document.getElementById('start-button');

if (startButton instanceof HTMLButtonElement) {
  startButton.addEventListener('click', (event) => {
    requestExpandedMode(event, 'game');
  });
}
