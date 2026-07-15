import {
  Display,
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
  unfinishedVersusMatchCount,
  organizeVersusLobby,
  validateVersusPattern,
  versusRules,
} from '../../shared/versus';
import {
  buildXpAnimationSegments,
  createInitialProgress,
  summarizeProgress,
  VERSUS_DRAW_XP,
  VERSUS_LOSS_XP,
  VERSUS_WIN_XP,
} from '../../shared/progression';
import type {
  ProgressReward,
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
  getVersusResult,
  postVersusLobby,
  releaseVersusInvite,
  submitRematchPattern,
  submitVersusInvitePattern,
  updateRematchRequest,
  VersusClientError,
} from '../versusClient';
import { markVersusInviteHandled } from '../versusShare';
import {
  TILE_WARS_COLORS,
  clearSceneContent,
  drawTileWarsLoadingMessage,
  drawOutcomeStrip,
  drawPlainRivalryRecord,
  drawRaisedPanel,
  drawStaticXpBar,
  drawTileButton,
  ensureTileWarsSceneShell,
  type TileWarsSceneShell,
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
  acceptInvite?: boolean;
  historyReturn?: {
    opponent: RivalryOpponentSummary;
    scrollOffset: number;
  };
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
  private acceptPendingInvite = false;
  private incomingInvite: VersusInviteSummary | null = null;
  private selectedKeys = new Set<string>();
  private status = 'Loading TILEWARS...';
  private loading = false;
  private pollEvent: Time.TimerEvent | null = null;
  private rewardVisible = false;
  private rewardAnimationComplete = false;
  private codeEntryVisible = false;
  private inviteCode = '';
  private codeEntryError = '';
  private codeInput: HTMLInputElement | null = null;
  private opponentSearchVisible = false;
  private opponentQuery = '';
  private allOpponents: RivalryOpponentSummary[] = [];
  private selectedOpponent: RivalryOpponentSummary | null = null;
  private opponentHistory: RivalryHistoryEntry[] = [];
  private historyScrollOffset = 0;
  private historyScrollMax = 0;
  private historyListTop = 0;
  private historyListBottom = 0;
  private historyListContainer: GameObjects.Container | null = null;
  private historyMaskGraphics: GameObjects.Graphics | null = null;
  private historyScrollbarThumb: GameObjects.Rectangle | null = null;
  private historyScrollbarTravel = 0;
  private historyPointerDragged = false;
  private pendingHistoryReturn: LobbySceneData['historyReturn'] = undefined;
  private sceneShell: TileWarsSceneShell | null = null;
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
    this.acceptPendingInvite =
      data.acceptInvite === true || this.registry.get('acceptSharedInvite') === true;
    this.registry.remove('sharedInviteId');
    this.registry.remove('acceptSharedInvite');
    this.incomingInvite = null;
    this.selectedKeys.clear();
    this.rewardVisible = false;
    this.rewardAnimationComplete = false;
    this.codeEntryVisible = false;
    this.inviteCode = '';
    this.codeEntryError = '';
    this.opponentSearchVisible = false;
    this.opponentQuery = '';
    this.allOpponents = [];
    this.selectedOpponent = null;
    this.opponentHistory = [];
    this.historyScrollOffset = 0;
    this.historyScrollMax = 0;
    this.pendingHistoryReturn = data.historyReturn;
  }

  create(): void {
    this.sceneShell = null;
    this.cameras.main.setBackgroundColor(COLORS.background);
    this.scale.on('resize', this.render, this);
    this.events.once('shutdown', this.handleShutdown, this);
    this.input.on('wheel', this.handleWheel, this);
    this.input.on('pointerdown', this.handlePointerDown, this);
    this.input.on('pointermove', this.handlePointerMove, this);
    this.input.on('pointerup', this.handlePointerUp, this);
    const codeInput = document.getElementById('versus-overlay-input');
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
    const inviteId = this.pendingInviteId;
    const acceptInvite = this.acceptPendingInvite;
    await this.refreshLobby(false, inviteId === null);
    if (this.pendingHistoryReturn) {
      const target = this.pendingHistoryReturn;
      this.pendingHistoryReturn = undefined;
      await this.openOpponentHistory(target.opponent, target.scrollOffset);
      return;
    }
    this.pendingInviteId = null;
    this.acceptPendingInvite = false;
    if (inviteId) {
      await this.openInvite(inviteId, acceptInvite);
    }
  }

  private handleShutdown(): void {
    this.scale.off('resize', this.render, this);
    this.input.off('wheel', this.handleWheel, this);
    this.input.off('pointerdown', this.handlePointerDown, this);
    this.input.off('pointermove', this.handlePointerMove, this);
    this.input.off('pointerup', this.handlePointerUp, this);
    this.codeInput?.removeEventListener('input', this.handleCodeInput);
    this.codeInput?.removeEventListener('keydown', this.handleCodeInputKey);
    this.hideCodeInput();
    this.codeInput = null;
    this.historyMaskGraphics?.destroy();
    this.historyMaskGraphics = null;
    this.pollEvent?.destroy();
    this.pollEvent = null;
  }

  private handleWheel(
    pointer: Input.Pointer,
    _objects: GameObjects.GameObject[],
    _deltaX: number,
    deltaY: number
  ): void {
    if (this.codeEntryVisible) {
      return;
    }
    if (this.selectedOpponent) {
      if (this.pointerIsInsideHistoryList(pointer)) {
        this.setHistoryScroll(this.historyScrollOffset + deltaY * 0.7);
      }
      return;
    }
    this.setScroll(this.cameras.main.scrollY + deltaY * 0.7);
  }

  private handlePointerDown(pointer: Input.Pointer): void {
    if (this.codeEntryVisible) {
      this.dragPointerY = null;
      return;
    }
    if (this.selectedOpponent) {
      this.dragPointerY = this.pointerIsInsideHistoryList(pointer) ? pointer.y : null;
      this.historyPointerDragged = false;
      return;
    }
    this.dragPointerY = pointer.y;
  }

  private handlePointerMove(pointer: Input.Pointer): void {
    if (this.codeEntryVisible) {
      this.dragPointerY = null;
      return;
    }
    if (!pointer.isDown || this.dragPointerY === null) {
      return;
    }
    const delta = this.dragPointerY - pointer.y;
    if (Math.abs(delta) > 2) {
      if (this.selectedOpponent) {
        this.historyPointerDragged = true;
        this.setHistoryScroll(this.historyScrollOffset + delta);
      } else {
        this.setScroll(this.cameras.main.scrollY + delta);
      }
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

  private pointerIsInsideHistoryList(pointer: Input.Pointer): boolean {
    return pointer.y >= this.historyListTop && pointer.y <= this.historyListBottom;
  }

  private setHistoryScroll(value: number): void {
    this.historyScrollOffset = PhaserMath.Clamp(value, 0, this.historyScrollMax);
    this.historyListContainer?.setY(this.historyListTop - this.historyScrollOffset);
    if (this.historyScrollbarThumb) {
      const progress = this.historyScrollMax > 0
        ? this.historyScrollOffset / this.historyScrollMax
        : 0;
      this.historyScrollbarThumb.y = this.historyListTop + progress * this.historyScrollbarTravel;
    }
  }

  private render(): void {
    this.hideCodeInput();
    this.historyMaskGraphics?.destroy();
    this.historyMaskGraphics = null;
    this.historyListContainer = null;
    this.historyScrollbarThumb = null;
    clearSceneContent(this, this.sceneShell);
    const width = this.scale.width;
    const mobile = width < 700;
    this.sceneShell = ensureTileWarsSceneShell(this, this.sceneShell, {
      width,
      height: this.selectedOpponent
        ? this.scale.height
        : Math.max(this.scale.height, this.contentHeight),
      headingY: this.lobby ? 34 : 46,
      mobile,
    });

    if (!this.lobby) {
      drawTileWarsLoadingMessage(this, this.status);
      return;
    }
    if (this.pickerMode) {
      this.drawPatternPicker();
    } else if (this.selectedOpponent) {
      this.drawOpponentHistoryScreen();
    } else {
      this.drawLobbyOverview();
    }
    if (this.selectedOpponent) {
      return;
    }
    if (this.opponentSearchVisible) {
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
      this.codeEntryError = '';
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
    drawRaisedPanel(this, 14, 68, width - 28, 82, COLORS.green);
    this.add.text(28, 84, `Level ${progress.level}`, this.headerStyle()).setOrigin(0, 0.5);
    this.add
      .text(
        width - 28,
        84,
        `${progress.levelXp}/${progress.xpForNextLevel} XP`,
        this.headerStyle('#33404c')
      )
      .setOrigin(1, 0.5);
    drawStaticXpBar(this, 28, 101, width - 56, progress.levelXp, progress.xpForNextLevel, 10);
    drawPlainRivalryRecord(this, width / 2, 132, progress.versus, 15);

    const searching = this.lobby.round?.status === 'matching';
    const unfinished = unfinishedVersusMatchCount(this.lobby.matches);
    const searchLimitReached =
      unfinished >= this.lobby.rules.maxUnfinishedMatches;
    const actionGap = 6;
    const actionWidth = (width - 28 - actionGap * 3) / 4;
    const actionStart = 14 + actionWidth / 2;
    const actionX = (index: number): number =>
      actionStart + index * (actionWidth + actionGap);
    this.createButton(actionX(0), 178, 'Back', (pointer) => this.goBack(pointer), 'orange', actionWidth);
    this.createButton(actionX(1), 178, searching ? 'Searching' : width < 430 ? 'Find' : 'Find Match', () => {
      this.openPublicPicker();
    }, 'blue', actionWidth, searching || searchLimitReached);
    this.createButton(actionX(2), 178, 'Invite', () => this.openPicker('invite-create'), 'accept', actionWidth);
    this.createButton(actionX(3), 178, width < 430 ? 'Code' : 'Enter Code', () => {
      this.codeEntryVisible = true;
      this.inviteCode = '';
      this.codeEntryError = '';
      this.render();
    }, 'decline', actionWidth);

    const sections = organizeVersusLobby(this.lobby);
    let y = searchLimitReached && !searching ? 248 : 220;
    if (searchLimitReached && !searching) {
      this.add
        .text(
          width / 2,
          217,
          `${unfinished} unfinished matches - finish one to search again.`,
          {
            fontFamily: 'Arial Black, Arial, sans-serif',
            fontSize: width < 430 ? '11px' : '12px',
            color: '#25313b',
            align: 'center',
            wordWrap: { width: width - 44, useAdvancedWrap: true },
          }
        )
        .setOrigin(0.5, 0);
    }
    if (searching) {
      y = this.drawLookingSection(y);
    }
    y = this.drawMatchSection('Active Matches', COLORS.playable, sections.activeMatches, y);
    y = this.drawPendingSection('Invitations', COLORS.orange, sections.invitations, y);
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
    this.contentHeight = Math.max(this.scale.height, y + 118);
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
      y += this.drawPendingCard(item, color, y) + 14;
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
      y += this.drawMatchCard(match, color, y) + 14;
    }
    return y + 8;
  }

  private drawLookingSection(y: number): number {
    const mobile = this.scale.width < 500;
    const height = mobile ? 126 : 88;
    this.drawCardPanel(COLORS.looking, y, height);
    this.add
      .text(30, y + 22, 'Searching for an opponent', this.cardTitleStyle())
      .setOrigin(0, 0.5);
    this.add
      .text(
        30,
        y + (mobile ? 54 : 54),
        'Your pattern is ready. Return when a match is found.',
        {
          ...this.cardBodyStyle(),
          wordWrap: { width: this.scale.width - (mobile ? 60 : 170) },
        }
      )
      .setOrigin(0, 0.5);
    this.createButton(
      this.scale.width - (mobile ? 76 : 66),
      mobile ? y + 101 : y + height / 2,
      'Cancel',
      () => void this.closeRound(),
      'decline',
      92
    );
    return y + height + 16;
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
      y += 108;
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
    const actionWidth = width < 430 ? 100 : 112;
    const rematchX = width - 76;
    this.drawCardPanel(COLORS.results, y, 94);
    this.add
      .text(30, y + 21, opponent.opponentDisplayName, this.cardTitleStyle())
      .setOrigin(0, 0.5);
    drawPlainRivalryRecord(this, width - 76, y + 21, opponent, 13);
    this.drawOutcomeDots(38, y + 66, opponent.recentOutcomes);
    this.add
      .zone(14, y, width - 28, 94)
      .setOrigin(0)
      .setInteractive({ useHandCursor: true })
      .on('pointerup', () => void this.openOpponentHistory(opponent));
    drawTileButton(this, {
      x: rematchX,
      y: y + 66,
      label: 'Rematch',
      variant: 'orange',
      width: actionWidth,
      height: 34,
      fontSize: 11,
      onClick: () => this.openOpponentRematch(opponent),
    });
  }

  private drawOutcomeDots(x: number, y: number, outcomes: RivalryOutcome[]): void {
    drawOutcomeStrip(this, x - 8, y - 8, outcomes, 16, 4);
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

  private drawMatchCard(match: VersusMatchSummary, color: number, y: number): number {
    const width = this.scale.width;
    const label =
      match.myAttemptStatus === 'playing'
        ? 'Continue'
        : match.myAttemptStatus === 'not-started'
          ? 'Play'
          : null;
    const status =
      match.myAttemptStatus === 'solved'
        ? 'Finished - waiting for opponent'
        : match.myAttemptStatus === 'playing'
          ? 'Continue solving the pattern'
          : "Solve your opponent's pattern";
    const cardHeight = 82;
    const actionY = y + 55;
    const actionWidth = label === 'Continue' ? 92 : 76;
    const actionX = width - 76;
    const statusWidth = label ? actionX - actionWidth / 2 - 42 : width - 60;
    this.drawCardPanel(color, y, cardHeight);
    this.add
      .text(30, y + 20, `vs ${match.opponentDisplayName}`, this.cardTitleStyle())
      .setOrigin(0, 0.5);
    drawPlainRivalryRecord(this, width - 76, y + 20, match.rivalry, 12);
    const statusLabel = this.add
      .text(30, actionY, status, this.cardBodyStyle())
      .setOrigin(0, 0.5);
    if (statusLabel.width > statusWidth) {
      statusLabel.setFontSize(
        Math.max(10, Math.floor(13 * statusWidth / statusLabel.width))
      );
    }
    if (label) {
      this.createButton(actionX, actionY, label, () => {
        this.scene.start('VersusGame', { matchId: match.matchId });
      }, 'accept', actionWidth);
    }
    return cardHeight;
  }

  private drawPendingCard(item: VersusPendingItem, color: number, y: number): number {
    if (item.kind === 'invite') {
      return this.drawInviteCard(item.invite, color, y);
    }
    return this.drawRematchCard(item.rematch, color, y);
  }

  private drawInviteCard(invite: VersusInviteSummary, color: number, y: number): number {
    const width = this.scale.width;
    const openCreator = invite.role === 'creator' && invite.status === 'open';
    const mobileActions = openCreator && width < 500;
    const mobile = width < 500;
    const cardHeight = openCreator || invite.role === 'acceptor' ? 118 : 92;
    this.drawCardPanel(color, y, cardHeight);
    const title = invite.role === 'creator'
      ? `Open Invitation - ${invite.inviteCode}`
      : `Invitation from ${invite.creatorDisplayName}`;
    const body =
      invite.role === 'acceptor'
        ? 'Invitation accepted — choose your pattern'
        : invite.status === 'accepted-awaiting-pattern'
          ? `${invite.acceptedByDisplayName ?? 'A player'} accepted - waiting for their pattern`
          : 'Waiting for an opponent to accept.';
    this.add.text(30, y + 20, title, this.cardTitleStyle()).setOrigin(0, 0.5);
    this.add
      .text(30, y + 49, body, {
        ...this.cardBodyStyle(),
        wordWrap: { width: width - 60 },
      })
      .setOrigin(0, 0.5);
    if (invite.role === 'acceptor') {
      const actionWidth = mobile ? (width - 44) / 2 : undefined;
      const actionGap = 8;
      const firstX = mobile && actionWidth
        ? 18 + actionWidth / 2
        : width / 2 - 70;
      const secondX = mobile && actionWidth
        ? firstX + actionWidth + actionGap
        : width / 2 + 70;
      this.createButton(firstX, y + 91, 'Choose Pattern', () => {
        this.pickerMode = 'invite-answer';
        this.pickerInviteId = invite.inviteId;
        this.selectedKeys.clear();
        this.render();
      }, 'accept', actionWidth);
      this.createButton(secondX, y + 91, 'Release', () => void this.releaseInvite(invite.inviteId), 'decline', actionWidth);
    } else if (invite.status === 'open') {
      if (mobileActions) {
        const gap = 6;
        const sideMargin = 26;
        const actionWidth = (width - sideMargin * 2 - gap * 2) / 3;
        const actionX = (index: number): number =>
          sideMargin + actionWidth / 2 + index * (actionWidth + gap);
        drawTileButton(this, {
          x: actionX(0), y: y + 91, label: 'Share', variant: 'blue',
          width: actionWidth, height: 34, fontSize: 12,
          onClick: () => void this.shareInvite(invite),
        });
        drawTileButton(this, {
          x: actionX(1), y: y + 91, label: 'Copy Code', variant: 'green',
          width: actionWidth, height: 34, fontSize: 12,
          onClick: () => void this.copyInviteCode(invite.inviteCode),
        });
        drawTileButton(this, {
          x: actionX(2), y: y + 91, label: 'Cancel', variant: 'red',
          width: actionWidth, height: 34, fontSize: 12,
          onClick: () => void this.cancelInvite(invite.inviteId),
        });
      } else {
        const actionWidth = Math.min(116, (width - 42) / 3);
        const start = width / 2 - actionWidth - 4;
        this.createButton(start, y + 91, 'Share Again', () => void this.shareInvite(invite), 'blue', actionWidth);
        this.createButton(width / 2, y + 91, 'Copy Code', () => void this.copyInviteCode(invite.inviteCode), 'accept', actionWidth);
        this.createButton(width / 2 + actionWidth + 4, y + 91, 'Cancel', () => void this.cancelInvite(invite.inviteId), 'decline', actionWidth);
      }
    }
    return cardHeight;
  }

  private drawRematchCard(rematch: VersusRematchSummary, color: number, y: number): number {
    const width = this.scale.width;
    const mobile = width < 500;
    const hasActions = rematch.role === 'responder' || rematch.status === 'pending';
    const cardHeight = mobile && hasActions ? 118 : 92;
    const actionsY = mobile ? y + 91 : y + 68;
    this.drawCardPanel(color, y, cardHeight);
    this.add
      .text(
        30,
        y + 20,
        rematch.role === 'requester'
          ? `Invitation to ${rematch.opponentDisplayName}`
          : `Invitation from ${rematch.opponentDisplayName}`,
        this.cardTitleStyle()
      )
      .setOrigin(0, 0.5);
    const body =
      rematch.role === 'requester'
        ? rematch.status === 'accepted-awaiting-pattern'
          ? `${rematch.opponentDisplayName} accepted — waiting for their pattern`
          : `Waiting for ${rematch.opponentDisplayName} to accept.`
        : rematch.status === 'accepted-awaiting-pattern'
          ? 'Invitation accepted — choose your pattern.'
          : `${rematch.opponentDisplayName} invited you to play again.`;
    this.add.text(30, y + 48, body, this.cardBodyStyle()).setOrigin(0, 0.5);
    if (rematch.role === 'responder') {
      const actionWidth = mobile ? (width - 60) / 2 : undefined;
      const actionGap = 8;
      const firstX = mobile && actionWidth
        ? 26 + actionWidth / 2
        : width / 2 - 70;
      const secondX = mobile && actionWidth
        ? firstX + actionWidth + actionGap
        : width / 2 + 70;
      if (rematch.status === 'pending') {
        this.drawRematchAction(firstX, actionsY, 'Accept', () => void this.acceptRematch(rematch), 'green', actionWidth);
      } else {
        this.drawRematchAction(firstX, actionsY, 'Choose Pattern', () => {
          this.openRematchAnswerPicker(rematch);
        }, 'green', actionWidth);
      }
      this.drawRematchAction(secondX, actionsY, 'Decline', () => void this.updateRematch(rematch, 'decline'), 'red', actionWidth);
    } else if (rematch.status === 'pending') {
      this.createButton(width - 72, actionsY, 'Cancel', () => void this.updateRematch(rematch, 'cancel'), 'decline', 92);
    }
    return cardHeight;
  }

  private drawRematchAction(
    x: number,
    y: number,
    label: string,
    onClick: () => void,
    variant: 'green' | 'red',
    width?: number
  ): void {
    drawTileButton(this, {
      x,
      y,
      label,
      onClick,
      variant,
      ...(width === undefined ? {} : { width }),
      height: 32,
      fontSize: 13,
    });
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
    const size = Math.min(width - 34, height - 220, 370);
    const cell = size / 5;
    const startX = (width - size) / 2;
    const startY = 126;
    this.add
      .text(width / 2, 78, 'Choose Your Pattern', {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: width < 700 ? '18px' : '21px',
        color: '#18212b',
        align: 'center',
        wordWrap: { width: width - 28 },
      })
      .setOrigin(0.5);
    this.add
      .text(width / 2, 103, `Select ${VERSUS_PATTERN_SIZE} connected tiles.`, {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: '13px',
        color: '#53606b',
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
    const validPattern = validateVersusPattern(this.selectedPattern()).valid;
    const controlWidth = Math.min(108, (width - 44) / 3);
    const controlGap = controlWidth + 6;
    this.createButton(width / 2 - controlGap, controlsY, 'Back', (pointer) => {
      this.goBack(pointer);
    }, 'orange', controlWidth);
    this.createButton(width / 2, controlsY, 'Clear', () => {
      this.selectedKeys.clear();
      this.status = `Pick ${VERSUS_PATTERN_SIZE} connected tiles.`;
      this.render();
    }, 'decline', controlWidth);
    this.createButton(width / 2 + controlGap, controlsY, this.loading ? 'Submitting...' : 'Submit', () => {
      void this.submitPattern();
    }, 'accept', controlWidth, !validPattern || this.loading);
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
    const modal = this.drawModal(240);
    this.add
      .text(this.scale.width / 2, modal.y + 46, 'Versus Invitation', this.modalTitleStyle())
      .setOrigin(0.5);
    this.add
      .text(
        this.scale.width / 2,
        modal.y + 108,
        `${invite.creatorDisplayName} has invited you to a 1v1 match.`,
        this.modalBodyStyle(modal.width - 40)
      )
      .setOrigin(0.5);
    this.createButton(this.scale.width / 2 - 82, modal.y + 188, 'Accept', () => {
      void this.acceptInvite(invite.inviteId);
    }, 'accept');
    this.createButton(this.scale.width / 2 + 82, modal.y + 188, 'Decline', () => {
      markVersusInviteHandled(invite.inviteId);
      this.incomingInvite = null;
      this.status = 'Invitation dismissed.';
      this.render();
    }, 'decline');
  }

  private drawCodeEntry(): void {
    const modal = this.drawModal(230);
    this.add
      .text(this.scale.width / 2, modal.y + 42, 'Enter Invite Code', this.modalTitleStyle())
      .setOrigin(0.5);
    const graphics = this.add.graphics();
    graphics.fillStyle(COLORS.paper, 1);
    graphics.fillRoundedRect(modal.x + 28, modal.y + 82, modal.width - 56, 54, 8);
    graphics.lineStyle(2, COLORS.line, 1);
    graphics.strokeRoundedRect(modal.x + 28, modal.y + 82, modal.width - 56, 54, 8);
    this.add
      .text(this.scale.width / 2, modal.y + 151, this.codeEntryError, {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: '12px',
        color: '#d93649',
        align: 'center',
      })
      .setName('invite-code-error')
      .setOrigin(0.5);
    this.createButton(this.scale.width / 2 - 82, modal.y + 188, 'Back', () => {
      this.codeEntryVisible = false;
      this.codeEntryError = '';
      this.render();
    }, 'orange');
    this.createButton(this.scale.width / 2 + 82, modal.y + 188, 'Play', () => void this.openInviteCode(), 'accept');
    this.showCodeInput(modal.x + 28, modal.y + 82, modal.width - 56, 54);
  }

  private drawOpponentSearchModal(): void {
    const modalHeight = Math.min(this.scale.height - 30, 520);
    const modal = this.drawModal(modalHeight);
    this.add
      .text(this.scale.width / 2, modal.y + 36, 'Search History', this.modalTitleStyle())
      .setOrigin(0.5);
    const graphics = this.add.graphics();
    graphics.fillStyle(COLORS.paper, 1);
    graphics.fillRoundedRect(modal.x + 24, modal.y + 67, modal.width - 48, 46, 8);
    graphics.lineStyle(2, COLORS.line, 1);
    graphics.strokeRoundedRect(modal.x + 24, modal.y + 67, modal.width - 48, 46, 8);
    this.add
      .text(modal.x + 38, modal.y + 90, '', {
        fontFamily: 'Arial, sans-serif', fontSize: '17px', color: '#18212b',
      })
      .setOrigin(0, 0.5);
    this.showCodeInput(modal.x + 24, modal.y + 67, modal.width - 48, 46);
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
      drawPlainRivalryRecord(this, modal.x + 83, rowY + 34, opponent, 11);
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

  private drawOpponentHistoryScreen(): void {
    const opponent = this.selectedOpponent;
    if (!opponent) {
      return;
    }
    const width = this.scale.width;
    const height = this.scale.height;
    this.cameras.main.scrollY = 0;
    drawRaisedPanel(this, 14, 68, width - 28, 112, COLORS.results);
    this.add
      .text(width / 2, 88, opponent.opponentDisplayName, {
        ...this.modalTitleStyle(),
        fontSize: width < 430 ? '20px' : '23px',
        wordWrap: { width: width - 56 },
        align: 'center',
      })
      .setOrigin(0.5);
    drawPlainRivalryRecord(this, width / 2, 119, opponent, 14);
    this.drawOutcomeDots(width / 2 - 40, 149, opponent.recentOutcomes);

    const listTop = this.drawSectionHeader('Matches', COLORS.results, 194);
    const backY = height - 30;
    const statusSpace = this.status ? 22 : 0;
    const listBottom = Math.max(listTop + 56, backY - 30 - statusSpace);
    const viewportHeight = Math.max(1, listBottom - listTop);
    const contentHeight = this.opponentHistory.length > 0
      ? this.opponentHistory.length * 64 - 8
      : 56;
    this.historyListTop = listTop;
    this.historyListBottom = listBottom;
    this.historyScrollMax = Math.max(0, contentHeight - viewportHeight);
    this.historyScrollOffset = PhaserMath.Clamp(
      this.historyScrollOffset,
      0,
      this.historyScrollMax
    );

    const maskGraphics = this.make.graphics({}, false);
    maskGraphics.fillStyle(0xffffff, 1);
    maskGraphics.fillRect(0, listTop, width, viewportHeight);
    const listMask = maskGraphics.createGeometryMask();
    this.historyMaskGraphics = maskGraphics;

    const list = this.add.container(0, listTop - this.historyScrollOffset);
    this.historyListContainer = list;
    const rowWidth = width - (this.historyScrollMax > 0 ? 40 : 28);
    this.opponentHistory.forEach((entry, index) => {
      this.drawHistoryRow(list, 14, index * 64, rowWidth, entry, listMask);
    });
    if (this.opponentHistory.length === 0) {
      const emptyLabel = this.add
        .text(
          width / 2,
          28,
          'No match history is available yet.',
          this.modalBodyStyle(width - 40)
        )
        .setOrigin(0.5)
        .setMask(listMask);
      list.add(emptyLabel);
    }

    if (this.historyScrollMax > 0) {
      const trackX = width - 19;
      this.add
        .rectangle(trackX, listTop, 4, viewportHeight, COLORS.line, 0.12)
        .setOrigin(0.5, 0);
      const thumbHeight = Math.max(
        30,
        viewportHeight * (viewportHeight / contentHeight)
      );
      this.historyScrollbarTravel = viewportHeight - thumbHeight;
      this.historyScrollbarThumb = this.add
        .rectangle(trackX, listTop, 4, thumbHeight, COLORS.blue, 0.9)
        .setOrigin(0.5, 0);
      this.setHistoryScroll(this.historyScrollOffset);
    } else {
      this.historyScrollbarTravel = 0;
    }

    if (this.status) {
      this.add
        .text(width / 2, backY - 34, this.status, {
          ...this.cardBodyStyle(),
          align: 'center',
          wordWrap: { width: width - 30 },
        })
        .setOrigin(0.5);
    }
    this.createButton(width / 2, backY, 'Back', () => {
      this.selectedOpponent = null;
      this.opponentHistory = [];
      this.historyScrollOffset = 0;
      this.historyScrollMax = 0;
      this.cameras.main.scrollY = 0;
      this.status = '';
      this.render();
    }, 'orange', 118);
    this.contentHeight = height;
    this.cameras.main.setBounds(0, 0, width, height);
    this.cameras.main.scrollY = 0;
  }

  private drawHistoryRow(
    container: GameObjects.Container,
    x: number,
    y: number,
    width: number,
    entry: RivalryHistoryEntry,
    mask: Display.Masks.GeometryMask
  ): void {
    const graphics = this.add.graphics().setMask(mask);
    container.add(graphics);
    graphics.fillStyle(COLORS.paper, 0.92);
    graphics.fillRoundedRect(x, y, width, 56, 7);
    const outcomeColor =
      entry.outcome === 'win'
        ? COLORS.green
        : entry.outcome === 'loss'
          ? COLORS.red
          : COLORS.orange;
    graphics.lineStyle(3, outcomeColor, 0.9);
    graphics.strokeRoundedRect(x, y, width, 56, 7);
    graphics.fillStyle(outcomeColor, 1);
    graphics.fillRoundedRect(x + 8, y + 13, 30, 30, 6);
    container.add(
      this.add.text(x + 23, y + 28, entry.outcome.charAt(0).toUpperCase(), {
        fontFamily: 'Arial Black, Arial, sans-serif', fontSize: '14px', color: '#ffffff',
      }).setOrigin(0.5).setMask(mask)
    );
    const dateLabel = this.add
      .text(
        x + width - 12,
        y + 28,
        new Date(entry.completedAt).toLocaleDateString(),
        {
          ...this.cardTitleStyle(),
          fontSize: this.scale.width < 430 ? '10px' : '12px',
          color: '#18212b',
        }
      )
      .setOrigin(1, 0.5)
      .setMask(mask);
    container.add(dateLabel);
    const scoreLabel = this.add
      .text(x + 48, y + 28, this.historyScoreText(entry), {
        ...this.cardTitleStyle(),
        fontSize: this.scale.width < 430 ? '11px' : '13px',
        color: '#18212b',
      })
      .setOrigin(0, 0.5)
      .setMask(mask);
    const scoreWidth = Math.max(100, width - 72 - dateLabel.width);
    if (scoreLabel.width > scoreWidth) {
      const fontSize = Number.parseInt(String(scoreLabel.style.fontSize), 10);
      scoreLabel.setFontSize(
        Math.max(9, Math.floor(fontSize * scoreWidth / scoreLabel.width))
      );
    }
    container.add(scoreLabel);
    const zone = this.add.zone(x, y, width, 56)
      .setOrigin(0)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => graphics.setAlpha(0.72))
      .on('pointerout', () => graphics.setAlpha(1))
      .on('pointerup', (pointer: Input.Pointer) => {
        graphics.setAlpha(1);
        if (
          !this.historyPointerDragged &&
          this.pointerIsInsideHistoryList(pointer)
        ) {
          void this.openHistoryResult(entry);
        }
      });
    container.add(zone);
  }

  private drawRewardModal(): void {
    if (!this.lobby) {
      return;
    }
    const modal = this.drawModal(292);
    const rewards = [...this.lobby.pendingRewards].sort(
      (first, second) => first.createdAt - second.createdAt
    );
    const amount = rewards.reduce((sum, reward) => sum + reward.amount, 0);
    const firstReward = rewards[0];
    const lastReward = rewards.at(-1);
    const initial = firstReward
      ? summarizeProgress({
          ...this.lobby.progress,
          totalXp: firstReward.previousTotalXp,
        })
      : this.lobby.progress;
    const displayedProgress = this.rewardAnimationComplete
      ? this.lobby.progress
      : initial;
    this.add
      .text(this.scale.width / 2, modal.y + 38, 'XP Earned', this.modalTitleStyle())
      .setOrigin(0.5);
    this.add
      .text(
        this.scale.width / 2,
        modal.y + 72,
        rewardReasonText(rewards),
        {
          fontFamily: 'Arial Black, Arial, sans-serif',
          fontSize: this.scale.width < 390 ? '13px' : '14px',
          color: '#25313b',
          align: 'center',
          wordWrap: {
            width: modal.width - 52,
            useAdvancedWrap: true,
          },
          maxLines: 2,
        }
      )
      .setOrigin(0.5, 0);
    this.add
      .text(this.scale.width / 2, modal.y + 120, `Level ${displayedProgress.level}`, {
        fontFamily: 'Arial Black, Arial, sans-serif', fontSize: '20px', color: '#25313b',
      })
      .setName('reward-level')
      .setOrigin(0.5);
    this.add
      .text(
        this.scale.width / 2,
        modal.y + 150,
        `${displayedProgress.levelXp}/${displayedProgress.xpForNextLevel} XP · +${amount} XP`,
        { fontFamily: 'Arial Black, Arial, sans-serif', fontSize: '13px', color: '#53606b' }
      )
      .setName('reward-xp')
      .setOrigin(0.5);
    const barX = modal.x + 28;
    const barY = modal.y + 172;
    const barWidth = modal.width - 56;
    const bar = this.add.graphics();
    bar.fillStyle(0xd8d0c5, 1);
    bar.fillRoundedRect(barX, barY, barWidth, 14, 7);
    bar.lineStyle(1, COLORS.line, 0.3);
    bar.strokeRoundedRect(barX, barY, barWidth, 14, 7);
    const fill = this.add
      .rectangle(barX, barY + 7, barWidth, 12, COLORS.green)
      .setOrigin(0, 0.5);
    const finalProgress = this.lobby.progress;
    if (this.rewardAnimationComplete || !firstReward || !lastReward) {
      fill.setScale(finalProgress.levelXp / finalProgress.xpForNextLevel, 1);
    } else {
      const segments = buildXpAnimationSegments(
        firstReward.previousTotalXp,
        lastReward.newTotalXp
      );
      this.animateRewardSegments(segments, 0, fill, amount);
    }
    this.createButton(
      this.scale.width / 2,
      modal.y + 247,
      'Continue',
      () => void this.dismissRewards(),
      'accept',
      116,
      !this.rewardAnimationComplete
    );
  }

  private animateRewardSegments(
    segments: ReturnType<typeof buildXpAnimationSegments>,
    index: number,
    fill: GameObjects.Rectangle,
    amount: number
  ): void {
    const segment = segments[index];
    const levelLabel = this.children.getByName('reward-level');
    const xpLabel = this.children.getByName('reward-xp');
    if (!segment) {
      this.rewardAnimationComplete = true;
      if (this.scene.isActive()) {
        this.render();
      }
      return;
    }
    if (levelLabel instanceof GameObjects.Text) {
      levelLabel.setText(`Level ${segment.level}`);
    }
    fill.setScale(segment.fromXp / segment.xpForNextLevel, 1);
    this.tweens.add({
      targets: fill,
      scaleX: segment.toXp / segment.xpForNextLevel,
      duration: 650,
      ease: 'Sine.easeOut',
      onUpdate: () => {
        if (xpLabel instanceof GameObjects.Text) {
          xpLabel.setText(
            `${Math.round(segment.xpForNextLevel * fill.scaleX)}/${segment.xpForNextLevel} XP · +${amount} XP`
          );
        }
      },
      onComplete: () => this.animateRewardSegments(segments, index + 1, fill, amount),
    });
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

  private handleCodeInput = (): void => {
    if (!this.codeInput) {
      return;
    }
    if (this.opponentSearchVisible && !this.selectedOpponent) {
      this.opponentQuery = this.codeInput.value.slice(0, 24);
      this.render();
      return;
    }
    const normalized = this.codeInput.value
      .replace(/[^a-zA-Z0-9]/g, '')
      .slice(0, 12)
      .toUpperCase();
    this.inviteCode = normalized;
    if (this.codeEntryError) {
      this.codeEntryError = '';
      const errorLabel = this.children.getByName('invite-code-error');
      if (errorLabel instanceof GameObjects.Text) {
        errorLabel.setText('');
      }
    }
    if (this.codeInput.value !== normalized) {
      this.codeInput.value = normalized;
    }
  };

  private handleCodeInputKey = (event: KeyboardEvent): void => {
    if (event.key === 'Enter' && this.codeEntryVisible) {
      event.preventDefault();
      void this.openInviteCode();
    } else if (
      event.key === 'Enter' &&
      this.opponentSearchVisible &&
      !this.selectedOpponent
    ) {
      const opponent = this.filteredOpponents()[0];
      if (opponent) {
        event.preventDefault();
        void this.openOpponentHistory(opponent);
      }
    }
  };

  private showCodeInput(x: number, y: number, width: number, height: number): void {
    if (!this.codeInput) {
      return;
    }
    const bounds = this.game.canvas.getBoundingClientRect();
    const scaleX = bounds.width / this.scale.width;
    const scaleY = bounds.height / this.scale.height;
    const historyMode = this.opponentSearchVisible && !this.selectedOpponent;
    this.codeInput.value = historyMode ? this.opponentQuery : this.inviteCode;
    this.codeInput.maxLength = historyMode ? 24 : 12;
    this.codeInput.placeholder = historyMode ? 'Search past opponents' : 'TYPE CODE';
    this.codeInput.setAttribute(
      'aria-label',
      historyMode ? 'Search past opponents' : 'Versus invitation code'
    );
    this.codeInput.classList.toggle('is-history', historyMode);
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
    this.codeInput?.classList.remove('is-history');
    this.codeInput?.blur();
  }

  private async refreshLobby(matchmake: boolean, renderAfter = true): Promise<void> {
    if (
      this.loading ||
      this.rewardVisible ||
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
        : '';
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
      if (renderAfter && this.scene.isActive()) {
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
        const response = await createRematchRequest(this.pickerMatchId, pattern);
        if (response.matchedMatchId) {
          this.scene.start('VersusGame', { matchId: response.matchedMatchId });
          return;
        }
        this.status = 'Invitation sent. Waiting for your opponent.';
      } else if (this.pickerMode === 'public') {
        await postVersusLobby('/api/versus/round', { pattern });
        this.status = 'Your pattern is waiting for a challenger. Play on your own time.';
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

  private async openInvite(inviteId: string, acceptImmediately = false): Promise<void> {
    try {
      const response = await getVersusInvite(inviteId);
      if (response.matchedMatchId && response.invite.role !== 'viewer') {
        const match = this.lobby?.matches.find(
          (candidate) => candidate.matchId === response.matchedMatchId
        );
        if (match?.status === 'active' && match.myAttemptStatus !== 'solved') {
          this.scene.start('VersusGame', { matchId: response.matchedMatchId });
        } else {
          this.status = 'This invitation is already in Active Matches or Results.';
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
        if (acceptImmediately) {
          await this.acceptInvite(response.invite.inviteId);
          return;
        }
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
      markVersusInviteHandled(inviteId);
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
    this.loading = true;
    let renderAfter = true;
    try {
      const response = await getVersusInviteByCode(this.inviteCode);
      this.codeEntryVisible = false;
      this.codeEntryError = '';
      await this.openInvite(response.invite.inviteId);
    } catch (error) {
      const message = clientErrorMessage(error);
      this.codeEntryError = message === 'Invitation code not found.'
        ? 'That invitation code is invalid.'
        : message;
      this.status = '';
      renderAfter = false;
      const errorLabel = this.children.getByName('invite-code-error');
      if (errorLabel instanceof GameObjects.Text) {
        errorLabel.setText(this.codeEntryError);
      }
    } finally {
      this.loading = false;
      if (renderAfter) {
        this.render();
      }
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
    opponent: RivalryOpponentSummary,
    scrollOffset = 0
  ): Promise<void> {
    if (this.loading) {
      return;
    }
    this.loading = true;
    try {
      const response = await getVersusRivalryHistory(opponent.opponentUserId);
      this.selectedOpponent = response.opponent;
      this.opponentHistory = response.history;
      this.historyScrollOffset = Math.max(0, scrollOffset);
      this.opponentSearchVisible = false;
      this.cameras.main.scrollY = 0;
      this.status = '';
    } catch (error) {
      this.status = clientErrorMessage(error);
    } finally {
      this.loading = false;
      this.render();
    }
  }

  private async openHistoryResult(entry: RivalryHistoryEntry): Promise<void> {
    if (this.loading || !this.selectedOpponent) {
      return;
    }
    const returnScrollOffset = this.historyScrollOffset;
    this.loading = true;
    this.status = 'Loading match details...';
    this.render();
    try {
      const response = await getVersusResult(entry.matchId);
      this.status = '';
      this.render();
      this.scene.launch('VersusResult', {
        match: response.match,
        completedAt: entry.completedAt,
        historyReturn: {
          opponent: this.selectedOpponent,
          scrollOffset: returnScrollOffset,
        },
      });
      this.scene.sleep();
      return;
    } catch {
      this.status = 'Detailed replay is no longer available.';
    } finally {
      this.loading = false;
      if (this.scene.isActive()) {
        this.render();
      }
    }
  }

  private openOpponentRematch(opponent: RivalryOpponentSummary): void {
    this.pickerMatchId = opponent.latestMatchId;
    this.openPicker('rematch-request');
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
      : 'not finished';
    const theirs = entry.opponentScore
      ? `${entry.opponentScore.guesses} guesses · ${formatDuration(entry.opponentScore.durationMs)}`
      : 'not finished';
    return `${mine} | ${theirs}`;
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
      this.status = action === 'cancel' ? 'Invitation cancelled.' : 'Invitation declined.';
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
    const title = 'TILEWARS invitation';
    const text = `I made a hidden pattern for you. Invite code: ${invite.inviteCode}`;
    if (invite.shareUrl && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, text, url: invite.shareUrl });
        this.status = 'Invite link ready. Waiting for opponent to accept.';
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          this.status = 'Invitation sharing cancelled.';
          return;
        }
      }
    }
    await showShareSheet({
      title,
      text: invite.shareUrl ? `${text}\n${invite.shareUrl}` : text,
      data: JSON.stringify({ type: 'pattern-invite', inviteId: invite.inviteId }),
    });
    this.status = 'Invite link ready. Waiting for opponent to accept.';
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
    this.rewardAnimationComplete = false;
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

  private openPublicPicker(): void {
    if (!this.lobby) {
      return;
    }
    const unfinished = unfinishedVersusMatchCount(this.lobby.matches);
    if (unfinished >= this.lobby.rules.maxUnfinishedMatches) {
      this.status = `You have ${unfinished} unfinished matches. Finish one before searching for another opponent.`;
      this.render();
      return;
    }
    this.openPicker('public');
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

  private createButton(
    x: number,
    y: number,
    label: string,
    onClick: (pointer: Input.Pointer) => void,
    variant: 'neutral' | 'accept' | 'decline' | 'blue' | 'orange' = 'neutral',
    width?: number,
    disabled = false
  ): GameObjects.Container {
    return drawTileButton(this, {
      x,
      y,
      label,
      onClick,
      variant:
        variant === 'accept'
          ? 'green'
          : variant === 'decline'
            ? 'red'
            : variant === 'neutral'
              ? 'dark'
              : variant,
      ...(width === undefined ? {} : { width }),
      height: 34,
      fontSize: 12,
      disabled,
    });
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

const rewardReasonText = (rewards: ProgressReward[]): string => {
  if (rewards.length === 0) {
    return 'Progress reward';
  }
  if (rewards.length === 1) {
    return rewardReasonLabel(rewards[0]!);
  }
  if (rewards.length === 2) {
    return rewards.map(rewardReasonLabel).join('\n');
  }

  const latest = rewards.at(-1)!;
  return `${rewards.length} completed match rewards\nLatest: ${rewardReasonLabel(latest)}`;
};

const rewardReasonLabel = (reward: ProgressReward): string => {
  if (reward.label.startsWith('Win vs ')) {
    return `Win against ${reward.label.slice('Win vs '.length)}`;
  }
  if (reward.label.startsWith('Draw vs ')) {
    return `Draw with ${reward.label.slice('Draw vs '.length)}`;
  }
  if (reward.label.startsWith('Loss vs ')) {
    return `Loss against ${reward.label.slice('Loss vs '.length)}`;
  }
  if (reward.label.startsWith('Match vs ')) {
    const opponent = reward.label.slice('Match vs '.length);
    if (reward.amount === VERSUS_WIN_XP) return `Win against ${opponent}`;
    if (reward.amount === VERSUS_DRAW_XP) return `Draw with ${opponent}`;
    if (reward.amount === VERSUS_LOSS_XP) return `Loss against ${opponent}`;
  }
  return reward.label;
};

const formatDuration = (durationMs: number): string => {
  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};
