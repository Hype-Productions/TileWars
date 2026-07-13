import {
  GameObjects,
  Input,
  Math as PhaserMath,
  Scene,
  Time,
  Types,
} from 'phaser';
import { exitExpandedMode, showShareSheet } from '@devvit/web/client';
import type { Coord } from '../../shared/pattern';
import { coordKey } from '../../shared/pattern';
import type {
  VersusInviteSummary,
  VersusLobbyResponse,
  VersusMatchSummary,
  VersusPendingItem,
  VersusRematchSummary,
} from '../../shared/versus';
import {
  VERSUS_PATTERN_SIZE,
  organizeVersusLobby,
  validateVersusPattern,
  versusRules,
} from '../../shared/versus';
import { createInitialProgress, summarizeProgress } from '../../shared/progression';
import type {
  RivalryHistoryEntry,
  RivalryOpponentSummary,
  RivalryOutcome,
} from '../../shared/progression';
import {
  acceptVersusInvite,
  acknowledgeRewards,
  cancelVersusInvite,
  createRematchRequest,
  createVersusInvite,
  getVersusInvite,
  getVersusInviteByCode,
  getVersusLobby,
  getVersusOpponents,
  getVersusRivalryHistory,
  postVersusLobby,
  releaseVersusInvite,
  submitRematchPattern,
  submitVersusInvitePattern,
  updateRematchRequest,
  VersusClientError,
} from '../versusClient';
import {
  TILE_WARS_COLORS,
  drawRaisedPanel,
  drawTileHeading,
  drawTileWarsBackdrop,
} from './tileWarsTheme';

type PickerMode =
  | 'public'
  | 'rematch-request'
  | 'rematch-answer'
  | 'invite-create'
  | 'invite-answer'
  | null;

type LobbySceneData = {
  rematchMatchId?: string;
  inviteId?: string;
};

const COLORS = {
  ...TILE_WARS_COLORS,
  tile: TILE_WARS_COLORS.paper,
  selected: TILE_WARS_COLORS.green,
  action: TILE_WARS_COLORS.blue,
  playable: TILE_WARS_COLORS.green,
  waiting: TILE_WARS_COLORS.orange,
  looking: TILE_WARS_COLORS.red,
  results: TILE_WARS_COLORS.blue,
};

export class VersusLobby extends Scene {
  private lobby: VersusLobbyResponse | null = null;
  private pickerMode: PickerMode = null;
  private pickerMatchId: string | null = null;
  private pickerRequestId: string | null = null;
  private pickerInviteId: string | null = null;
  private pendingInviteId: string | null = null;
  private incomingInvite: VersusInviteSummary | null = null;
  private selectedKeys = new Set<string>();
  private status = 'Loading Versus...';
  private loading = false;
  private pollEvent: Time.TimerEvent | null = null;
  private rewardVisible = false;
  private codeEntryVisible = false;
  private inviteCode = '';
  private codeInput: HTMLInputElement | null = null;
  private opponentSearchVisible = false;
  private opponentQuery = '';
  private allOpponents: RivalryOpponentSummary[] = [];
  private selectedOpponent: RivalryOpponentSummary | null = null;
  private opponentHistory: RivalryHistoryEntry[] = [];
  private historyPage = 0;
  private contentHeight = 768;
  private dragPointerY: number | null = null;
  private knownMatchIds = new Set<string>();
  private hasLoadedLobby = false;

  constructor() {
    super('VersusLobby');
  }

  init(data: LobbySceneData): void {
    this.pickerMode = data.rematchMatchId ? 'rematch-request' : null;
    this.pickerMatchId = data.rematchMatchId ?? null;
    this.pickerRequestId = null;
    this.pickerInviteId = null;
    this.pendingInviteId =
      data.inviteId ?? this.registry.get('sharedInviteId') ?? null;
    this.registry.remove('sharedInviteId');
    this.incomingInvite = null;
    this.selectedKeys.clear();
    this.rewardVisible = false;
    this.codeEntryVisible = false;
    this.inviteCode = '';
    this.opponentSearchVisible = false;
    this.opponentQuery = '';
    this.allOpponents = [];
    this.selectedOpponent = null;
    this.opponentHistory = [];
    this.historyPage = 0;
  }

  create(): void {
    this.cameras.main.setBackgroundColor(COLORS.background);
    this.scale.on('resize', this.render, this);
    this.events.once('shutdown', this.handleShutdown, this);
    this.input.on('wheel', this.handleWheel, this);
    this.input.on('pointerdown', this.handlePointerDown, this);
    this.input.on('pointermove', this.handlePointerMove, this);
    this.input.on('pointerup', this.handlePointerUp, this);
    this.input.keyboard?.on('keydown', this.handleCodeKey, this);
    const codeInput = document.getElementById('versus-code-input');
    this.codeInput = codeInput instanceof HTMLInputElement ? codeInput : null;
    this.codeInput?.addEventListener('input', this.handleCodeInput);
    this.codeInput?.addEventListener('keydown', this.handleCodeInputKey);
    this.render();
    void this.initializeLobby();
    this.pollEvent = this.time.addEvent({
      delay: 15_000,
      loop: true,
      callback: () => void this.refreshLobby(true),
    });
  }

  private async initializeLobby(): Promise<void> {
    await this.refreshLobby(false);
    const inviteId = this.pendingInviteId;
    this.pendingInviteId = null;
    if (inviteId) {
      await this.openInvite(inviteId);
    }
  }

  private handleShutdown(): void {
    this.scale.off('resize', this.render, this);
    this.input.off('wheel', this.handleWheel, this);
    this.input.off('pointerdown', this.handlePointerDown, this);
    this.input.off('pointermove', this.handlePointerMove, this);
    this.input.off('pointerup', this.handlePointerUp, this);
    this.input.keyboard?.off('keydown', this.handleCodeKey, this);
    this.codeInput?.removeEventListener('input', this.handleCodeInput);
    this.codeInput?.removeEventListener('keydown', this.handleCodeInputKey);
    this.hideCodeInput();
    this.codeInput = null;
    this.pollEvent?.destroy();
    this.pollEvent = null;
  }

  private handleWheel(
    _pointer: Input.Pointer,
    _objects: GameObjects.GameObject[],
    _deltaX: number,
    deltaY: number
  ): void {
    this.setScroll(this.cameras.main.scrollY + deltaY * 0.7);
  }

  private handlePointerDown(pointer: Input.Pointer): void {
    this.dragPointerY = pointer.y;
  }

  private handlePointerMove(pointer: Input.Pointer): void {
    if (!pointer.isDown || this.dragPointerY === null) {
      return;
    }
    const delta = this.dragPointerY - pointer.y;
    if (Math.abs(delta) > 2) {
      this.setScroll(this.cameras.main.scrollY + delta);
      this.dragPointerY = pointer.y;
    }
  }

  private handlePointerUp(): void {
    this.dragPointerY = null;
  }

  private setScroll(value: number): void {
    const max = Math.max(0, this.contentHeight - this.scale.height);
    this.cameras.main.scrollY = PhaserMath.Clamp(value, 0, max);
  }

  private render(): void {
    this.hideCodeInput();
    this.tweens.killAll();
    this.children.removeAll(true);
    this.input.resetCursor();
    const width = this.scale.width;
    const mobile = width < 700;
    drawTileWarsBackdrop(
      this,
      width,
      Math.max(this.scale.height, this.contentHeight)
    );
    drawTileHeading(this, 'Versus', width / 2, 34, mobile);
    this.createButton(
      52,
      34,
      'Back',
      (pointer) => this.goBack(pointer),
      'orange'
    );

    if (!this.lobby) {
      this.drawCenteredMessage(this.status);
      return;
    }
    if (this.pickerMode) {
      this.drawPatternPicker();
    } else {
      this.drawLobbyOverview();
    }
    if (this.selectedOpponent) {
      this.drawOpponentHistoryModal();
    } else if (this.opponentSearchVisible) {
      this.drawOpponentSearchModal();
    } else if (this.incomingInvite) {
      this.drawInvitePrompt(this.incomingInvite);
    } else if (this.codeEntryVisible) {
      this.drawCodeEntry();
    } else if (this.rewardVisible && this.lobby.pendingRewards.length > 0) {
      this.drawRewardModal();
    }
  }

  private goBack(pointer: Input.Pointer): void {
    if (
      this.pickerMode ||
      this.incomingInvite ||
      this.codeEntryVisible ||
      this.opponentSearchVisible ||
      this.selectedOpponent
    ) {
      this.pickerMode = null;
      this.pickerMatchId = null;
      this.pickerRequestId = null;
      this.pickerInviteId = null;
      this.incomingInvite = null;
      this.codeEntryVisible = false;
      this.opponentSearchVisible = false;
      this.selectedOpponent = null;
      this.selectedKeys.clear();
      this.status = 'Choose what to play.';
      this.render();
      return;
    }
    try {
      if (pointer.event instanceof MouseEvent) {
        exitExpandedMode(pointer.event);
        return;
      }
    } catch {
      // Static previews do not provide Reddit's Devvit bridge.
    }

    try {
      window.open('splash.html', '_self');
    } catch {
      // Some embedded contexts may block same-frame navigation.
    }
  }

  private drawLobbyOverview(): void {
    if (!this.lobby) {
      return;
    }
    const width = this.scale.width;
    const progress = this.lobby.progress;
    drawRaisedPanel(this, 14, 68, width - 28, 56, COLORS.green);
    this.add.text(28, 86, `Level ${progress.level}`, this.headerStyle()).setOrigin(0, 0.5);
    this.add
      .text(width - 28, 86, `${progress.dailyStreak} day streak`, this.headerStyle('#16a66a'))
      .setOrigin(1, 0.5);
    this.add
      .text(
        width / 2,
        108,
        `${progress.versus.wins}W  ${progress.versus.losses}L  ${progress.versus.draws}D`,
        { fontFamily: 'Arial, sans-serif', fontSize: '14px', color: '#33404c' }
      )
      .setOrigin(0.5);

    const searching = this.lobby.round?.status === 'matching';
    const actionSpread = Math.min(150, Math.max(108, width * 0.29));
    this.createButton(width / 2 - actionSpread, 154, searching ? 'Cancel Search' : 'Find Match', () => {
      if (searching) {
        void this.closeRound();
      } else {
        this.openPicker('public');
      }
    }, searching ? 'decline' : 'blue');
    this.createButton(width / 2, 154, 'Invite', () => this.openPicker('invite-create'), 'accept');
    this.createButton(width / 2 + actionSpread, 154, 'Enter Code', () => {
      this.codeEntryVisible = true;
      this.inviteCode = '';
      this.render();
    }, 'orange');

    const sections = organizeVersusLobby(this.lobby);
    let y = 198;
    y = this.drawPendingSection('Action Needed', COLORS.action, sections.actionItems, y);
    y = this.drawMatchSection('Your Matches', COLORS.playable, sections.playableMatches, y);
    y = this.drawMixedWaitingSection(
      sections.waitingItems,
      sections.waitingMatches,
      y
    );
    if (searching) {
      y = this.drawLookingSection(y);
    }
    y = this.drawOpponentResultsSection(this.lobby.recentOpponents, y);
    this.add
      .text(width / 2, y + 10, this.status, {
        fontFamily: 'Arial, sans-serif',
        fontSize: '14px',
        color: '#33404c',
        align: 'center',
        wordWrap: { width: width - 30 },
      })
      .setOrigin(0.5, 0);
    this.contentHeight = Math.max(this.scale.height, y + 70);
    this.cameras.main.setBounds(0, 0, width, this.contentHeight);
    this.setScroll(this.cameras.main.scrollY);
  }

  private drawPendingSection(
    title: string,
    color: number,
    items: VersusPendingItem[],
    y: number
  ): number {
    if (items.length === 0) {
      return y;
    }
    y = this.drawSectionHeader(title, color, y);
    for (const item of items) {
      this.drawPendingCard(item, color, y);
      y += 106;
    }
    return y + 8;
  }

  private drawMatchSection(
    title: string,
    color: number,
    matches: VersusMatchSummary[],
    y: number
  ): number {
    if (matches.length === 0) {
      return y;
    }
    y = this.drawSectionHeader(title, color, y);
    for (const match of matches) {
      this.drawMatchCard(match, color, y);
      y += 106;
    }
    return y + 8;
  }

  private drawMixedWaitingSection(
    items: VersusPendingItem[],
    matches: VersusMatchSummary[],
    y: number
  ): number {
    if (items.length === 0 && matches.length === 0) {
      return y;
    }
    y = this.drawSectionHeader('Waiting', COLORS.waiting, y);
    for (const item of items) {
      this.drawPendingCard(item, COLORS.waiting, y);
      y += 106;
    }
    for (const match of matches) {
      this.drawMatchCard(match, COLORS.waiting, y);
      y += 106;
    }
    return y + 8;
  }

  private drawLookingSection(y: number): number {
    y = this.drawSectionHeader('Looking', COLORS.looking, y);
    this.drawCardPanel(COLORS.looking, y, 82);
    this.add
      .text(30, y + 24, 'Looking for an opponent', this.cardTitleStyle())
      .setOrigin(0, 0.5);
    this.add
      .text(30, y + 54, 'Your pattern is saved. You can safely leave.', this.cardBodyStyle())
      .setOrigin(0, 0.5);
    return y + 98;
  }

  private drawOpponentResultsSection(
    opponents: RivalryOpponentSummary[],
    y: number
  ): number {
    if (opponents.length === 0) {
      return y;
    }
    y = this.drawSectionHeader('Results', COLORS.results, y);
    this.drawSearchIcon(this.scale.width - 34, y - 20);
    for (const opponent of opponents.slice(0, 3)) {
      this.drawOpponentCard(opponent, y);
      y += 98;
    }
    return y + 8;
  }

  private drawSearchIcon(x: number, y: number): void {
    const graphics = this.add.graphics();
    graphics.lineStyle(3, COLORS.results, 1);
    graphics.strokeCircle(x - 4, y - 3, 8);
    graphics.lineBetween(x + 2, y + 3, x + 10, y + 11);
    this.add
      .zone(x - 20, y - 20, 40, 40)
      .setOrigin(0)
      .setInteractive({ useHandCursor: true })
      .on('pointerup', () => void this.openOpponentSearch());
  }

  private drawOpponentCard(opponent: RivalryOpponentSummary, y: number): void {
    const width = this.scale.width;
    this.drawCardPanel(COLORS.results, y, 84);
    this.add
      .text(30, y + 21, opponent.opponentDisplayName, this.cardTitleStyle())
      .setOrigin(0, 0.5);
    this.add
      .text(
        width - 28,
        y + 21,
        `${opponent.wins}-${opponent.losses}${opponent.draws ? ` · ${opponent.draws}D` : ''}`,
        { fontFamily: 'Arial Black, Arial, sans-serif', fontSize: '14px', color: '#f28d13' }
      )
      .setOrigin(1, 0.5);
    this.add.text(30, y + 56, 'History', this.cardBodyStyle()).setOrigin(0, 0.5);
    this.drawOutcomeDots(94, y + 56, opponent.recentOutcomes);
    this.add
      .zone(14, y, width - 28, 84)
      .setOrigin(0)
      .setInteractive({ useHandCursor: true })
      .on('pointerup', () => void this.openOpponentHistory(opponent));
  }

  private drawOutcomeDots(x: number, y: number, outcomes: RivalryOutcome[]): void {
    outcomes.slice(-5).forEach((outcome, index) => {
      const graphics = this.add.graphics();
      graphics.fillStyle(
        outcome === 'win'
          ? COLORS.green
          : outcome === 'loss'
            ? COLORS.red
            : COLORS.orange,
        1
      );
      graphics.fillRoundedRect(x + index * 20 - 7, y - 7, 14, 14, 4);
      graphics.lineStyle(1, COLORS.line, 0.55);
      graphics.strokeRoundedRect(x + index * 20 - 7, y - 7, 14, 14, 4);
    });
  }

  private drawSectionHeader(title: string, color: number, y: number): number {
    const graphics = this.add.graphics();
    graphics.fillStyle(color, 1);
    graphics.fillRoundedRect(16, y + 2, 8, 24, 4);
    this.add
      .text(32, y + 14, title, {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: '17px',
        color: '#18212b',
      })
      .setOrigin(0, 0.5);
    return y + 34;
  }

  private drawMatchCard(match: VersusMatchSummary, color: number, y: number): void {
    const width = this.scale.width;
    this.drawCardPanel(color, y, 92);
    this.add
      .text(30, y + 20, `vs ${match.opponentDisplayName}`, this.cardTitleStyle())
      .setOrigin(0, 0.5);
    this.add
      .text(
        width - 28,
        y + 20,
        `${match.rivalry.wins}-${match.rivalry.losses}${match.rivalry.draws ? ` · ${match.rivalry.draws}D` : ''}`,
        { fontFamily: 'Arial Black, Arial, sans-serif', fontSize: '13px', color: '#f28d13' }
      )
      .setOrigin(1, 0.5);
    this.add
      .text(30, y + 49, `${this.sourceLabel(match.source)} · ${this.matchStatus(match)}`, {
        ...this.cardBodyStyle(),
        wordWrap: { width: Math.max(180, width - 190) },
      })
      .setOrigin(0, 0.5);
    const label =
      match.status !== 'active'
        ? 'Results'
        : match.myAttemptStatus === 'playing'
          ? 'Continue'
          : match.myAttemptStatus === 'not-started'
            ? 'Play'
            : null;
    if (label) {
      this.createButton(width - 72, y + 67, label, () => {
        if (match.status === 'active') {
          this.scene.start('VersusGame', { matchId: match.matchId });
        } else {
          this.openResult(match);
        }
      });
    }
    if (match.status !== 'active') {
      this.createButton(width - 178, y + 67, 'Rematch', () => {
        this.pickerMode = 'rematch-request';
        this.pickerMatchId = match.matchId;
        this.selectedKeys.clear();
        this.status = `Pick ${VERSUS_PATTERN_SIZE} connected tiles.`;
        this.render();
      });
    }
  }

  private drawPendingCard(item: VersusPendingItem, color: number, y: number): void {
    if (item.kind === 'invite') {
      this.drawInviteCard(item.invite, color, y);
    } else {
      this.drawRematchCard(item.rematch, color, y);
    }
  }

  private drawInviteCard(invite: VersusInviteSummary, color: number, y: number): void {
    const width = this.scale.width;
    this.drawCardPanel(color, y, 92);
    const title = invite.role === 'creator' ? 'Invitation' : `From ${invite.creatorDisplayName}`;
    const body =
      invite.role === 'acceptor'
        ? 'Invitation accepted · choose your pattern'
        : invite.status === 'accepted-awaiting-pattern'
          ? `${invite.acceptedByDisplayName ?? 'A player'} accepted · waiting for their pattern`
          : 'Invite link ready · waiting for someone to accept';
    this.add.text(30, y + 20, title, this.cardTitleStyle()).setOrigin(0, 0.5);
    this.add.text(30, y + 48, body, this.cardBodyStyle()).setOrigin(0, 0.5);
    if (invite.role === 'acceptor') {
      this.createButton(width - 78, y + 68, 'Choose Pattern', () => {
        this.pickerMode = 'invite-answer';
        this.pickerInviteId = invite.inviteId;
        this.selectedKeys.clear();
        this.render();
      });
      this.createButton(width - 210, y + 68, 'Release', () => void this.releaseInvite(invite.inviteId));
    } else if (invite.status === 'open') {
      this.createButton(width - 62, y + 68, 'Cancel', () => void this.cancelInvite(invite.inviteId));
      this.createButton(width - 154, y + 68, 'Copy Code', () => void this.copyInviteCode(invite.inviteCode));
      this.createButton(width - 258, y + 68, 'Share Again', () => void this.shareInvite(invite));
    }
  }

  private drawRematchCard(rematch: VersusRematchSummary, color: number, y: number): void {
    const width = this.scale.width;
    this.drawCardPanel(color, y, 92);
    this.add
      .text(30, y + 20, `Rematch · ${rematch.opponentDisplayName}`, this.cardTitleStyle())
      .setOrigin(0, 0.5);
    const body =
      rematch.role === 'requester'
        ? rematch.status === 'accepted-awaiting-pattern'
          ? `${rematch.opponentDisplayName} accepted · waiting for their pattern`
          : `Request sent · waiting for ${rematch.opponentDisplayName}`
        : rematch.status === 'accepted-awaiting-pattern'
          ? 'Rematch accepted · choose your pattern'
          : `${rematch.opponentDisplayName} wants a rematch`;
    this.add.text(30, y + 48, body, this.cardBodyStyle()).setOrigin(0, 0.5);
    if (rematch.role === 'responder') {
      if (rematch.status === 'pending') {
        this.createButton(width / 2 - 70, y + 68, 'Accept', () => void this.acceptRematch(rematch), 'accept');
      } else {
        this.createButton(width / 2 - 70, y + 68, 'Choose Pattern', () => {
          this.openRematchAnswerPicker(rematch);
        }, 'accept');
      }
      this.createButton(width / 2 + 70, y + 68, 'Decline', () => void this.updateRematch(rematch, 'decline'), 'decline');
    } else if (rematch.status === 'pending') {
      this.createButton(width - 72, y + 68, 'Cancel', () => void this.updateRematch(rematch, 'cancel'));
    }
    const source = this.lobby?.matches.find((match) => match.matchId === rematch.sourceMatchId);
    if (source) {
      this.createButton(width - 62, y + 20, 'Result', () => this.openResult(source));
    }
  }

  private drawCardPanel(color: number, y: number, height: number): void {
    drawRaisedPanel(
      this,
      14,
      y,
      this.scale.width - 28,
      height,
      color,
      COLORS.panel
    );
    const accent = this.add.graphics();
    accent.fillStyle(color, 1);
    accent.fillRoundedRect(14, y, 9, height, 4);
  }

  private drawPatternPicker(): void {
    const width = this.scale.width;
    const height = this.scale.height;
    const title =
      this.pickerMode === 'invite-create'
        ? 'Choose a pattern to invite a friend'
        : this.pickerMode === 'invite-answer'
          ? 'Choose your invitation pattern'
          : this.pickerMode === 'rematch-request'
            ? 'Choose your rematch pattern'
            : this.pickerMode === 'rematch-answer'
              ? 'Answer the rematch'
              : 'Choose your public pattern';
    const size = Math.min(width - 34, height - 220, 370);
    const cell = size / 5;
    const startX = (width - size) / 2;
    const startY = 126;
    this.add
      .text(width / 2, 82, `${title} (${VERSUS_PATTERN_SIZE} connected tiles)`, {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: width < 700 ? '16px' : '19px',
        color: '#18212b',
        align: 'center',
        wordWrap: { width: width - 28 },
      })
      .setOrigin(0.5);
    for (let row = 0; row < 5; row += 1) {
      for (let col = 0; col < 5; col += 1) {
        const coord = { row, col };
        const key = coordKey(coord);
        const x = startX + col * cell;
        const y = startY + row * cell;
        const selected = this.selectedKeys.has(key);
        const graphics = this.add.graphics();
        graphics.fillStyle(COLORS.shadow, 0.14);
        graphics.fillRoundedRect(x + 6, y + 8, cell - 8, cell - 8, 6);
        graphics.fillStyle(selected ? COLORS.selected : COLORS.tile, 1);
        graphics.fillRoundedRect(x + 3, y + 3, cell - 6, cell - 6, 6);
        graphics.lineStyle(2, COLORS.line, 1);
        graphics.strokeRoundedRect(x + 3, y + 3, cell - 6, cell - 6, 6);
        this.add
          .text(x + cell / 2, y + cell / 2, '', {
            fontFamily: 'Arial Black, Arial, sans-serif',
            fontSize: `${Math.max(12, Math.floor(cell * 0.2))}px`,
            color: '#18212b',
          })
          .setOrigin(0.5);
        this.add
          .zone(x, y, cell, cell)
          .setOrigin(0)
          .setInteractive({ useHandCursor: true })
          .on('pointerdown', () => {
            if (selected) {
              this.selectedKeys.delete(key);
            } else if (this.selectedKeys.size < VERSUS_PATTERN_SIZE) {
              this.selectedKeys.add(key);
            }
            this.status = this.patternStatus();
            this.render();
          });
      }
    }
    const controlsY = startY + size + 34;
    this.createButton(width / 2 - 88, controlsY, 'Clear', () => {
      this.selectedKeys.clear();
      this.status = `Pick ${VERSUS_PATTERN_SIZE} connected tiles.`;
      this.render();
    });
    this.createButton(width / 2 + 88, controlsY, this.loading ? 'Submitting...' : 'Submit', () => {
      void this.submitPattern();
    });
    this.add
      .text(width / 2, controlsY + 42, this.status, {
        fontFamily: 'Arial, sans-serif', fontSize: '15px', color: '#33404c',
        align: 'center', wordWrap: { width: width - 30 },
      })
      .setOrigin(0.5);
    this.contentHeight = this.scale.height;
    this.cameras.main.scrollY = 0;
  }

  private drawInvitePrompt(invite: VersusInviteSummary): void {
    const modal = this.drawModal(300);
    this.add
      .text(this.scale.width / 2, modal.y + 46, 'Versus invitation', this.modalTitleStyle())
      .setOrigin(0.5);
    this.add
      .text(
        this.scale.width / 2,
        modal.y + 112,
        `${invite.creatorDisplayName} invited you to solve their hidden pattern.`,
        this.modalBodyStyle(modal.width - 40)
      )
      .setOrigin(0.5);
    this.add
      .text(this.scale.width / 2, modal.y + 162, 'Accept first, then submit your own pattern.', this.modalBodyStyle(modal.width - 40))
      .setOrigin(0.5);
    this.createButton(this.scale.width / 2 - 82, modal.y + 244, 'Accept', () => {
      void this.acceptInvite(invite.inviteId);
    }, 'accept');
    this.createButton(this.scale.width / 2 + 82, modal.y + 244, 'Decline', () => {
      this.incomingInvite = null;
      this.status = 'Invitation dismissed.';
      this.render();
    }, 'decline');
  }

  private drawCodeEntry(): void {
    const modal = this.drawModal(260);
    this.add
      .text(this.scale.width / 2, modal.y + 42, 'Enter invite code', this.modalTitleStyle())
      .setOrigin(0.5);
    const graphics = this.add.graphics();
    graphics.fillStyle(COLORS.paper, 1);
    graphics.fillRoundedRect(modal.x + 28, modal.y + 82, modal.width - 56, 54, 8);
    graphics.lineStyle(2, COLORS.line, 1);
    graphics.strokeRoundedRect(modal.x + 28, modal.y + 82, modal.width - 56, 54, 8);
    this.add
      .text(this.scale.width / 2, modal.y + 158, 'Use your keyboard, then press Enter.', this.modalBodyStyle(modal.width - 40))
      .setOrigin(0.5);
    this.createButton(this.scale.width / 2 - 82, modal.y + 214, 'Cancel', () => {
      this.codeEntryVisible = false;
      this.render();
    });
    this.createButton(this.scale.width / 2 + 82, modal.y + 214, 'Open', () => void this.openInviteCode());
    this.showCodeInput(modal.x + 28, modal.y + 82, modal.width - 56, 54);
  }

  private drawOpponentSearchModal(): void {
    const modalHeight = Math.min(this.scale.height - 30, 520);
    const modal = this.drawModal(modalHeight);
    this.add
      .text(this.scale.width / 2, modal.y + 36, 'Find an opponent', this.modalTitleStyle())
      .setOrigin(0.5);
    const graphics = this.add.graphics();
    graphics.fillStyle(COLORS.paper, 1);
    graphics.fillRoundedRect(modal.x + 24, modal.y + 67, modal.width - 48, 46, 8);
    graphics.lineStyle(2, COLORS.line, 1);
    graphics.strokeRoundedRect(modal.x + 24, modal.y + 67, modal.width - 48, 46, 8);
    this.add
      .text(modal.x + 38, modal.y + 90, this.opponentQuery || 'Type a Reddit handle', {
        fontFamily: 'Arial, sans-serif', fontSize: '17px',
        color: this.opponentQuery ? '#18212b' : '#8b929b',
      })
      .setOrigin(0, 0.5);
    const maxRows = Math.max(2, Math.min(5, Math.floor((modalHeight - 190) / 57)));
    const results = this.filteredOpponents().slice(0, maxRows);
    if (results.length === 0) {
      this.add
        .text(this.scale.width / 2, modal.y + 165, 'No opponents found.', this.modalBodyStyle(modal.width - 40))
        .setOrigin(0.5);
    }
    results.forEach((opponent, index) => {
      const rowY = modal.y + 142 + index * 57;
      const row = this.add.graphics();
      row.fillStyle(COLORS.paper, 0.92);
      row.fillRoundedRect(modal.x + 24, rowY, modal.width - 48, 48, 7);
      this.add
        .text(modal.x + 36, rowY + 15, opponent.opponentDisplayName, {
          fontFamily: 'Arial Black, Arial, sans-serif', fontSize: '14px', color: '#18212b',
        })
        .setOrigin(0, 0.5);
      this.add
        .text(modal.x + 36, rowY + 34, `${opponent.wins}-${opponent.losses}${opponent.draws ? ` · ${opponent.draws}D` : ''}`, this.cardBodyStyle())
        .setOrigin(0, 0.5);
      this.drawOutcomeDots(modal.x + modal.width - 130, rowY + 25, opponent.recentOutcomes);
      this.add
        .zone(modal.x + 24, rowY, modal.width - 48, 48)
        .setOrigin(0)
        .setInteractive({ useHandCursor: true })
        .on('pointerup', () => void this.openOpponentHistory(opponent));
    });
    this.createButton(this.scale.width / 2, modal.y + modalHeight - 30, 'Close', () => {
      this.opponentSearchVisible = false;
      this.render();
    });
  }

  private drawOpponentHistoryModal(): void {
    const opponent = this.selectedOpponent;
    if (!opponent) {
      return;
    }
    const modalHeight = Math.min(this.scale.height - 30, 570);
    const modal = this.drawModal(modalHeight);
    this.add
      .text(this.scale.width / 2, modal.y + 32, opponent.opponentDisplayName, this.modalTitleStyle())
      .setOrigin(0.5);
    this.add
      .text(
        this.scale.width / 2,
        modal.y + 63,
        `You ${opponent.wins} - ${opponent.losses}${opponent.draws ? ` · ${opponent.draws} draws` : ''}`,
        { fontFamily: 'Arial Black, Arial, sans-serif', fontSize: '14px', color: '#f28d13' }
      )
      .setOrigin(0.5);
    this.drawOutcomeDots(this.scale.width / 2 - 40, modal.y + 91, opponent.recentOutcomes);
    const pageSize = Math.max(2, Math.min(6, Math.floor((modalHeight - 180) / 57)));
    const pageCount = Math.max(1, Math.ceil(this.opponentHistory.length / pageSize));
    this.historyPage = Math.min(this.historyPage, pageCount - 1);
    const entries = this.opponentHistory.slice(
      this.historyPage * pageSize,
      (this.historyPage + 1) * pageSize
    );
    entries.forEach((entry, index) => {
      const rowY = modal.y + 119 + index * 57;
      this.drawHistoryRow(modal.x + 24, rowY, modal.width - 48, entry);
    });
    if (entries.length === 0) {
      this.add
        .text(this.scale.width / 2, modal.y + 160, 'No compact match history is available yet.', this.modalBodyStyle(modal.width - 40))
        .setOrigin(0.5);
    }
    const controlsY = modal.y + modalHeight - 30;
    if (this.historyPage > 0) {
      this.createButton(this.scale.width / 2 - 120, controlsY, 'Newer', () => {
        this.historyPage -= 1;
        this.render();
      });
    }
    this.createButton(this.scale.width / 2, controlsY, 'Close', () => {
      this.selectedOpponent = null;
      this.opponentHistory = [];
      this.render();
    });
    if (this.historyPage + 1 < pageCount) {
      this.createButton(this.scale.width / 2 + 120, controlsY, 'Older', () => {
        this.historyPage += 1;
        this.render();
      });
    }
  }

  private drawHistoryRow(
    x: number,
    y: number,
    width: number,
    entry: RivalryHistoryEntry
  ): void {
    const graphics = this.add.graphics();
    graphics.fillStyle(COLORS.paper, 0.92);
    graphics.fillRoundedRect(x, y, width, 48, 7);
    const color = entry.outcome === 'win' ? '#218c4a' : entry.outcome === 'loss' ? '#c83d3d' : '#7b8490';
    this.add
      .text(x + 12, y + 15, entry.outcome.toUpperCase(), {
        fontFamily: 'Arial Black, Arial, sans-serif', fontSize: '13px', color,
      })
      .setOrigin(0, 0.5);
    this.add
      .text(x + width - 12, y + 15, new Date(entry.completedAt).toLocaleDateString(), this.cardBodyStyle())
      .setOrigin(1, 0.5);
    this.add
      .text(x + 12, y + 35, this.historyScoreText(entry), this.cardBodyStyle())
      .setOrigin(0, 0.5);
  }

  private drawRewardModal(): void {
    if (!this.lobby) {
      return;
    }
    const modal = this.drawModal(220);
    const amount = this.lobby.pendingRewards.reduce((sum, reward) => sum + reward.amount, 0);
    this.add
      .text(this.scale.width / 2, modal.y + 45, 'Progress updated', this.modalTitleStyle())
      .setOrigin(0.5);
    this.add
      .text(this.scale.width / 2, modal.y + 105, `+${amount} XP`, {
        fontFamily: 'Arial Black, Arial, sans-serif', fontSize: '34px', color: '#35a866',
      })
      .setOrigin(0.5);
    this.createButton(this.scale.width / 2, modal.y + 172, 'Continue', () => void this.dismissRewards());
  }

  private drawModal(height: number): { x: number; y: number; width: number } {
    const width = Math.min(this.scale.width - 28, 430);
    const x = (this.scale.width - width) / 2;
    const y = this.cameras.main.scrollY + (this.scale.height - height) / 2;
    this.add.zone(0, this.cameras.main.scrollY, this.scale.width, this.scale.height).setOrigin(0).setInteractive();
    const overlay = this.add.graphics();
    overlay.fillStyle(0x111820, 0.5);
    overlay.fillRect(0, this.cameras.main.scrollY, this.scale.width, this.scale.height);
    drawRaisedPanel(this, x, y, width, height, COLORS.line, COLORS.panel);
    return { x, y, width };
  }

  private handleCodeKey(event: KeyboardEvent): void {
    if (this.opponentSearchVisible && !this.selectedOpponent) {
      if (event.key === 'Backspace') {
        this.opponentQuery = this.opponentQuery.slice(0, -1);
      } else if (event.key.length === 1 && this.opponentQuery.length < 24) {
        this.opponentQuery += event.key;
      } else {
        return;
      }
      this.render();
    }
  }

  private handleCodeInput = (): void => {
    if (!this.codeInput) {
      return;
    }
    const normalized = this.codeInput.value
      .replace(/[^a-zA-Z0-9]/g, '')
      .slice(0, 12)
      .toUpperCase();
    this.inviteCode = normalized;
    if (this.codeInput.value !== normalized) {
      this.codeInput.value = normalized;
    }
  };

  private handleCodeInputKey = (event: KeyboardEvent): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void this.openInviteCode();
    }
  };

  private showCodeInput(x: number, y: number, width: number, height: number): void {
    if (!this.codeInput) {
      return;
    }
    const bounds = this.game.canvas.getBoundingClientRect();
    const scaleX = bounds.width / this.scale.width;
    const scaleY = bounds.height / this.scale.height;
    this.codeInput.value = this.inviteCode;
    this.codeInput.style.left = `${bounds.left + x * scaleX}px`;
    this.codeInput.style.top = `${bounds.top + (y - this.cameras.main.scrollY) * scaleY}px`;
    this.codeInput.style.width = `${width * scaleX}px`;
    this.codeInput.style.height = `${height * scaleY}px`;
    this.codeInput.style.fontSize = `${Math.max(16, 21 * Math.min(scaleX, scaleY))}px`;
    this.codeInput.classList.add('is-visible');
    this.codeInput.focus({ preventScroll: true });
    this.codeInput.setSelectionRange(this.codeInput.value.length, this.codeInput.value.length);
  }

  private hideCodeInput(): void {
    this.codeInput?.classList.remove('is-visible');
    this.codeInput?.blur();
  }

  private async refreshLobby(matchmake: boolean): Promise<void> {
    if (
      this.loading ||
      this.pickerMode ||
      this.incomingInvite ||
      this.codeEntryVisible ||
      this.opponentSearchVisible ||
      this.selectedOpponent
    ) {
      return;
    }
    this.loading = true;
    try {
      const data =
        matchmake && this.lobby?.round?.status === 'matching'
          ? await postVersusLobby('/api/versus/matchmake')
          : await getVersusLobby();
      const newMatch = this.hasLoadedLobby
        ? data.matches.find((match) => !this.knownMatchIds.has(match.matchId))
        : undefined;
      this.lobby = data;
      this.knownMatchIds = new Set(data.matches.map((match) => match.matchId));
      this.hasLoadedLobby = true;
      this.rewardVisible = this.rewardVisible || data.pendingRewards.length > 0;
      this.status = newMatch
        ? `Match ready vs ${newMatch.opponentDisplayName}.`
        : 'Versus is up to date.';
    } catch (error) {
      if (!this.lobby && isLocalPreview()) {
        this.lobby = {
          type: 'versus-lobby', serverNow: Date.now(), rules: versusRules(), round: null,
          matches: [], pendingItems: [], recentOpponents: [],
          progress: summarizeProgress(createInitialProgress()),
          pendingRewards: [],
        };
        this.status = 'Local UI preview. Server features require Reddit playtest.';
      } else {
        this.status = clientErrorMessage(error);
      }
    } finally {
      this.loading = false;
      if (this.scene.isActive()) {
        this.render();
      }
    }
  }

  private async submitPattern(): Promise<void> {
    if (this.loading) {
      return;
    }
    const pattern = this.selectedPattern();
    const validation = validateVersusPattern(pattern);
    if (!validation.valid) {
      this.status = validation.message;
      this.render();
      return;
    }
    this.loading = true;
    this.status = 'Submitting your hidden pattern...';
    this.render();
    try {
      if (this.pickerMode === 'invite-create') {
        const response = await createVersusInvite(pattern);
        await this.shareInvite(response.invite);
        this.clearPicker();
        this.loading = false;
        await this.refreshLobby(false);
        return;
      }
      if (this.pickerMode === 'invite-answer' && this.pickerInviteId) {
        const response = await submitVersusInvitePattern(this.pickerInviteId, pattern);
        if (response.matchedMatchId) {
          this.scene.start('VersusGame', { matchId: response.matchedMatchId });
          return;
        }
      } else if (
        this.pickerMode === 'rematch-answer' &&
        this.pickerMatchId &&
        this.pickerRequestId
      ) {
        const response = await submitRematchPattern(
          this.pickerMatchId,
          this.pickerRequestId,
          pattern
        );
        if (response.matchedMatchId) {
          this.scene.start('VersusGame', { matchId: response.matchedMatchId });
          return;
        }
      } else if (this.pickerMode === 'rematch-request' && this.pickerMatchId) {
        await createRematchRequest(this.pickerMatchId, pattern);
        this.status = 'Rematch request sent.';
      } else if (this.pickerMode === 'public') {
        await postVersusLobby('/api/versus/round', { pattern });
        this.status = 'Looking for an opponent. You can safely leave.';
      }
      this.clearPicker();
      this.loading = false;
      await this.refreshLobby(false);
    } catch (error) {
      this.status = clientErrorMessage(error);
    } finally {
      this.loading = false;
      if (this.scene.isActive()) {
        this.render();
      }
    }
  }

  private async openInvite(inviteId: string): Promise<void> {
    try {
      const response = await getVersusInvite(inviteId);
      if (response.matchedMatchId && response.invite.role !== 'viewer') {
        const match = this.lobby?.matches.find(
          (candidate) => candidate.matchId === response.matchedMatchId
        );
        if (match?.status === 'active' && match.myAttemptStatus !== 'solved') {
          this.scene.start('VersusGame', { matchId: response.matchedMatchId });
        } else {
          this.status = 'This invitation is already in your Waiting or Results history.';
        }
        return;
      }
      if (response.invite.role === 'creator') {
        this.status = 'This is your own invitation.';
      } else if (
        response.invite.status === 'accepted-awaiting-pattern' &&
        response.invite.role === 'acceptor'
      ) {
        this.pickerMode = 'invite-answer';
        this.pickerInviteId = response.invite.inviteId;
      } else if (response.invite.status === 'open') {
        this.incomingInvite = response.invite;
      } else {
        this.status = 'This invitation is no longer available.';
      }
    } catch (error) {
      this.status = clientErrorMessage(error);
    }
    this.render();
  }

  private async acceptInvite(inviteId: string): Promise<void> {
    this.loading = true;
    try {
      const response = await acceptVersusInvite(inviteId);
      this.incomingInvite = null;
      this.pickerMode = 'invite-answer';
      this.pickerInviteId = response.invite.inviteId;
      this.selectedKeys.clear();
      this.status = `Pick ${VERSUS_PATTERN_SIZE} connected tiles.`;
    } catch (error) {
      this.status = clientErrorMessage(error);
    } finally {
      this.loading = false;
      this.render();
    }
  }

  private async openInviteCode(): Promise<void> {
    if (this.inviteCode.length === 0 || this.loading) {
      return;
    }
    this.hideCodeInput();
    this.loading = true;
    try {
      const response = await getVersusInviteByCode(this.inviteCode);
      this.codeEntryVisible = false;
      await this.openInvite(response.invite.inviteId);
    } catch (error) {
      this.status = clientErrorMessage(error);
    } finally {
      this.loading = false;
      this.render();
    }
  }

  private async openOpponentSearch(): Promise<void> {
    if (this.loading) {
      return;
    }
    this.loading = true;
    try {
      this.allOpponents = (await getVersusOpponents()).opponents;
      this.opponentQuery = '';
      this.opponentSearchVisible = true;
    } catch (error) {
      this.status = clientErrorMessage(error);
    } finally {
      this.loading = false;
      this.render();
    }
  }

  private async openOpponentHistory(
    opponent: RivalryOpponentSummary
  ): Promise<void> {
    if (this.loading) {
      return;
    }
    this.loading = true;
    try {
      const response = await getVersusRivalryHistory(opponent.opponentUserId);
      this.selectedOpponent = response.opponent;
      this.opponentHistory = response.history;
      this.historyPage = 0;
    } catch (error) {
      this.status = clientErrorMessage(error);
    } finally {
      this.loading = false;
      this.render();
    }
  }

  private filteredOpponents(): RivalryOpponentSummary[] {
    const query = this.opponentQuery.trim().toLowerCase();
    return query
      ? this.allOpponents.filter((opponent) =>
          opponent.opponentDisplayName.toLowerCase().includes(query)
        )
      : this.allOpponents;
  }

  private historyScoreText(entry: RivalryHistoryEntry): string {
    const mine = entry.myScore
      ? `${entry.myScore.guesses} guesses · ${formatDuration(entry.myScore.durationMs)}`
      : 'You did not finish';
    const theirs = entry.opponentScore
      ? `${entry.opponentScore.guesses} guesses · ${formatDuration(entry.opponentScore.durationMs)}`
      : 'opponent did not finish';
    return `${mine} / ${theirs}`;
  }

  private async acceptRematch(rematch: VersusRematchSummary): Promise<void> {
    this.loading = true;
    try {
      const response = await updateRematchRequest(
        rematch.sourceMatchId,
        rematch.requestId,
        'accept'
      );
      this.openRematchAnswerPicker(response.rematch);
    } catch (error) {
      this.status = clientErrorMessage(error);
    } finally {
      this.loading = false;
      this.render();
    }
  }

  private openRematchAnswerPicker(rematch: VersusRematchSummary): void {
    this.pickerMode = 'rematch-answer';
    this.pickerMatchId = rematch.sourceMatchId;
    this.pickerRequestId = rematch.requestId;
    this.selectedKeys.clear();
    this.status = `Pick ${VERSUS_PATTERN_SIZE} connected tiles.`;
    this.render();
  }

  private async updateRematch(
    rematch: VersusRematchSummary,
    action: 'decline' | 'cancel'
  ): Promise<void> {
    this.loading = true;
    try {
      await updateRematchRequest(rematch.sourceMatchId, rematch.requestId, action);
      this.status = action === 'cancel' ? 'Rematch request cancelled.' : 'Rematch declined.';
      this.loading = false;
      await this.refreshLobby(false);
    } catch (error) {
      this.status = clientErrorMessage(error);
    } finally {
      this.loading = false;
      this.render();
    }
  }

  private async cancelInvite(inviteId: string): Promise<void> {
    this.loading = true;
    try {
      await cancelVersusInvite(inviteId);
      this.status = 'Invitation cancelled.';
      this.loading = false;
      await this.refreshLobby(false);
    } catch (error) {
      this.status = clientErrorMessage(error);
    } finally {
      this.loading = false;
      this.render();
    }
  }

  private async releaseInvite(inviteId: string): Promise<void> {
    this.loading = true;
    try {
      await releaseVersusInvite(inviteId);
      this.status = 'Invitation released.';
      this.loading = false;
      await this.refreshLobby(false);
    } catch (error) {
      this.status = clientErrorMessage(error);
    } finally {
      this.loading = false;
      this.render();
    }
  }

  private async shareInvite(invite: VersusInviteSummary): Promise<void> {
    await showShareSheet({
      title: 'Pattern Tiles challenge',
      text: `I made a hidden pattern for you. Invite code: ${invite.inviteCode}`,
      data: JSON.stringify({ type: 'pattern-invite', inviteId: invite.inviteId }),
    });
    this.status = 'Invite link ready. Waiting for someone to accept.';
  }

  private async copyInviteCode(inviteCode: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(inviteCode);
      this.status = `Invite code ${inviteCode} copied.`;
    } catch {
      this.status = `Invite code: ${inviteCode}`;
    }
    this.render();
  }

  private async closeRound(): Promise<void> {
    this.loading = true;
    try {
      this.lobby = await postVersusLobby('/api/versus/round/close');
      this.status = 'Search cancelled. Existing matches stay active.';
    } catch (error) {
      this.status = clientErrorMessage(error);
    } finally {
      this.loading = false;
      this.render();
    }
  }

  private async dismissRewards(): Promise<void> {
    if (!this.lobby) {
      return;
    }
    const rewardIds = this.lobby.pendingRewards.map((reward) => reward.rewardId);
    this.rewardVisible = false;
    this.lobby = { ...this.lobby, pendingRewards: [] };
    this.render();
    try {
      await acknowledgeRewards(rewardIds);
    } catch (error) {
      this.status = clientErrorMessage(error);
    }
  }

  private openPicker(mode: Exclude<PickerMode, 'rematch-answer' | null>): void {
    this.pickerMode = mode;
    this.selectedKeys.clear();
    this.status = `Pick ${VERSUS_PATTERN_SIZE} connected tiles.`;
    this.cameras.main.scrollY = 0;
    this.render();
  }

  private clearPicker(): void {
    this.pickerMode = null;
    this.pickerMatchId = null;
    this.pickerRequestId = null;
    this.pickerInviteId = null;
    this.selectedKeys.clear();
  }

  private selectedPattern(): Coord[] {
    return [...this.selectedKeys]
      .map((key) => {
        const [rowText = '0', colText = '0'] = key.split(',');
        const row = Number(rowText);
        const col = Number(colText);
        return { row, col };
      })
      .sort((a, b) => a.row - b.row || a.col - b.col);
  }

  private patternStatus(): string {
    if (this.selectedKeys.size < VERSUS_PATTERN_SIZE) {
      return `${VERSUS_PATTERN_SIZE - this.selectedKeys.size} tiles left.`;
    }
    return validateVersusPattern(this.selectedPattern()).message;
  }

  private matchStatus(match: VersusMatchSummary): string {
    if (match.status !== 'active') {
      return match.outcome === 'win'
        ? 'You won'
        : match.outcome === 'loss'
          ? 'Opponent won'
          : match.outcome === 'draw'
            ? 'Draw'
            : 'Match ended';
    }
    if (match.myAttemptStatus === 'solved') {
      return 'You finished · waiting for opponent';
    }
    return match.myAttemptStatus === 'playing'
      ? "Continue solving your opponent's pattern"
      : "Solve your opponent's pattern";
  }

  private sourceLabel(source: VersusMatchSummary['source']): string {
    return source === 'public' ? 'Public match' : source === 'invite' ? 'Invitation' : 'Rematch';
  }

  private openResult(match: VersusMatchSummary): void {
    this.scene.start('VersusResult', { match, progress: this.lobby?.progress });
  }

  private createButton(
    x: number,
    y: number,
    label: string,
    onClick: (pointer: Input.Pointer) => void,
    variant: 'neutral' | 'accept' | 'decline' | 'blue' | 'orange' = 'neutral'
  ): void {
    const width = Math.max(78, Math.min(126, label.length * 7 + 28));
    const backgroundColor =
      variant === 'accept'
        ? COLORS.green
        : variant === 'decline'
          ? COLORS.red
          : variant === 'blue'
            ? COLORS.blue
            : variant === 'orange'
              ? COLORS.orange
              : COLORS.line;
    const hoverColor =
      variant === 'accept'
        ? 0x27bf7d
        : variant === 'decline'
          ? 0xff6878
          : variant === 'blue'
            ? 0x5bb4ff
            : variant === 'orange'
              ? 0xffc45c
              : 0x354555;
    const graphics = this.add.graphics();
    const buttonLabel = this.add
      .text(x, y, label, {
        fontFamily: 'Arial Black, Arial, sans-serif', fontSize: '12px', color: '#ffffff',
      })
      .setOrigin(0.5);
    const drawButton = (color: number, offset: number): void => {
      graphics.clear();
      graphics.fillStyle(COLORS.shadow, 0.2);
      graphics.fillRoundedRect(x - width / 2 + 3, y - 13 + 5, width, 32, 7);
      graphics.fillStyle(color, 1);
      graphics.fillRoundedRect(x - width / 2, y - 16 + offset, width, 32, 7);
      graphics.lineStyle(2, COLORS.line, 0.75);
      graphics.strokeRoundedRect(x - width / 2, y - 16 + offset, width, 32, 7);
      buttonLabel.setY(y + offset);
    };
    drawButton(backgroundColor, 0);
    this.add
      .zone(x - width / 2, y - 16, width, 32)
      .setOrigin(0)
      .setInteractive({ useHandCursor: true })
      .on('pointerover', () => drawButton(hoverColor, -2))
      .on('pointerout', () => drawButton(backgroundColor, 0))
      .on('pointerdown', () => drawButton(backgroundColor, 3))
      .on('pointerup', (pointer: Input.Pointer) => {
        drawButton(hoverColor, -2);
        onClick(pointer);
      });
  }

  private drawCenteredMessage(message: string): void {
    this.add
      .text(this.scale.width / 2, this.scale.height / 2, message, {
        fontFamily: 'Arial, sans-serif', fontSize: '18px', color: '#33404c',
        align: 'center', wordWrap: { width: this.scale.width - 40 },
      })
      .setOrigin(0.5);
  }

  private headerStyle(color = '#18212b'): Types.GameObjects.Text.TextStyle {
    return { fontFamily: 'Arial Black, Arial, sans-serif', fontSize: '17px', color };
  }

  private cardTitleStyle(): Types.GameObjects.Text.TextStyle {
    return { fontFamily: 'Arial Black, Arial, sans-serif', fontSize: '16px', color: '#18212b' };
  }

  private cardBodyStyle(): Types.GameObjects.Text.TextStyle {
    return { fontFamily: 'Arial, sans-serif', fontSize: '13px', color: '#33404c' };
  }

  private modalTitleStyle(): Types.GameObjects.Text.TextStyle {
    return { fontFamily: 'Arial Black, Arial, sans-serif', fontSize: '22px', color: '#18212b' };
  }

  private modalBodyStyle(width: number): Types.GameObjects.Text.TextStyle {
    return {
      fontFamily: 'Arial, sans-serif', fontSize: '15px', color: '#33404c',
      align: 'center', wordWrap: { width },
    };
  }
}

const clientErrorMessage = (error: unknown): string =>
  error instanceof VersusClientError ? error.message : 'Versus is temporarily unavailable.';

const isLocalPreview = (): boolean =>
  window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

const formatDuration = (durationMs: number): string => {
  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};
