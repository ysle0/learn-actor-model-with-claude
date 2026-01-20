/**
 * Game Room Actor Pattern - 멀티플레이어 게임 룸 예제
 *
 * 게임 룸의 Actor 기반 구현을 보여줍니다.
 */

// ============================================
// 타입 정의
// ============================================

type RoomStatus = 'waiting' | 'starting' | 'playing' | 'finished';

interface PlayerInfo {
  playerId: string;
  name: string;
  isReady: boolean;
  score: number;
}

interface RoomState {
  roomId: string;
  status: RoomStatus;
  players: Map<string, PlayerInfo>;
  maxPlayers: number;
  minPlayers: number;
}

// ============================================
// 메시지 타입
// ============================================

type RoomMessage =
  | { type: 'JOIN_ROOM'; playerId: string; playerName: string }
  | { type: 'LEAVE_ROOM'; playerId: string }
  | { type: 'SET_READY'; playerId: string; ready: boolean }
  | { type: 'GAME_ACTION'; playerId: string; action: any }
  | { type: 'START_GAME' }
  | { type: 'END_GAME'; winnerId?: string }
  | { type: 'GET_STATE' }
  | { type: 'TICK' };

type PlayerMessage =
  | { type: 'ROOM_STATE'; state: RoomState }
  | { type: 'PLAYER_JOINED'; player: PlayerInfo }
  | { type: 'PLAYER_LEFT'; playerId: string }
  | { type: 'PLAYER_READY'; playerId: string; ready: boolean }
  | { type: 'GAME_STARTING'; countdown: number }
  | { type: 'GAME_STARTED' }
  | { type: 'GAME_ACTION'; playerId: string; action: any }
  | { type: 'GAME_ENDED'; winnerId?: string; scores: Map<string, number> };

// ============================================
// Actor 기본 인프라
// ============================================

type ActorRef<T> = {
  send: (msg: T) => void;
  ask: <R>(msg: T) => Promise<R>;
  id: string;
};

class ActorSystem {
  private actors = new Map<string, any>();

  createActor<T, S>(
    id: string,
    initialState: S,
    behavior: (state: S, msg: T, ctx: ActorContext<T>) => S | Promise<S>
  ): ActorRef<T> {
    const actor = new StatefulActor(id, initialState, behavior, this);
    this.actors.set(id, actor);
    return actor.ref();
  }

  getActor<T>(id: string): ActorRef<T> | undefined {
    const actor = this.actors.get(id);
    return actor?.ref();
  }

  removeActor(id: string): void {
    this.actors.delete(id);
  }
}

interface ActorContext<T> {
  self: ActorRef<T>;
  system: ActorSystem;
  broadcast: (targets: ActorRef<any>[], msg: any) => void;
}

class StatefulActor<T, S> {
  private state: S;
  private mailbox: Array<{ msg: T; resolve?: (value: any) => void }> = [];
  private processing = false;
  private context: ActorContext<T>;

  constructor(
    private id: string,
    initialState: S,
    private behavior: (state: S, msg: T, ctx: ActorContext<T>) => S | Promise<S>,
    private system: ActorSystem
  ) {
    this.state = initialState;
    this.context = {
      self: this.ref(),
      system,
      broadcast: (targets, msg) => {
        targets.forEach(t => t.send(msg));
      },
    };
  }

  ref(): ActorRef<T> {
    return {
      id: this.id,
      send: (msg: T) => {
        this.mailbox.push({ msg });
        this.processNext();
      },
      ask: <R>(msg: T): Promise<R> => {
        return new Promise(resolve => {
          this.mailbox.push({ msg, resolve });
          this.processNext();
        });
      },
    };
  }

  private async processNext(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (this.mailbox.length > 0) {
      const { msg, resolve } = this.mailbox.shift()!;
      try {
        const result = await this.behavior(this.state, msg, this.context);
        if (result !== undefined) {
          this.state = result;
        }
        if (resolve) {
          resolve(this.state);
        }
      } catch (error) {
        console.error(`[${this.id}] Error:`, error);
      }
    }

    this.processing = false;
  }
}

// ============================================
// Room Actor
// ============================================

function createRoomActor(system: ActorSystem, roomId: string): ActorRef<RoomMessage> {
  const initialState: RoomState = {
    roomId,
    status: 'waiting',
    players: new Map(),
    maxPlayers: 4,
    minPlayers: 2,
  };

  // 플레이어 Actor 참조 저장
  const playerActors = new Map<string, ActorRef<PlayerMessage>>();

  return system.createActor<RoomMessage, RoomState>(
    `room-${roomId}`,
    initialState,
    (state, msg, ctx) => {
      switch (msg.type) {
        case 'JOIN_ROOM': {
          if (state.players.size >= state.maxPlayers) {
            console.log(`[Room ${roomId}] Room is full, rejecting ${msg.playerName}`);
            return state;
          }

          if (state.status !== 'waiting') {
            console.log(`[Room ${roomId}] Game in progress, rejecting ${msg.playerName}`);
            return state;
          }

          const player: PlayerInfo = {
            playerId: msg.playerId,
            name: msg.playerName,
            isReady: false,
            score: 0,
          };

          state.players.set(msg.playerId, player);

          // 플레이어 Actor 생성
          const playerActor = createPlayerActor(system, msg.playerId, msg.playerName);
          playerActors.set(msg.playerId, playerActor);

          console.log(`[Room ${roomId}] ${msg.playerName} joined (${state.players.size}/${state.maxPlayers})`);

          // 다른 플레이어들에게 알림
          broadcast(playerActors, msg.playerId, { type: 'PLAYER_JOINED', player });

          // 새 플레이어에게 현재 상태 전송
          playerActor.send({ type: 'ROOM_STATE', state });

          return state;
        }

        case 'LEAVE_ROOM': {
          const player = state.players.get(msg.playerId);
          if (!player) return state;

          state.players.delete(msg.playerId);
          playerActors.delete(msg.playerId);

          console.log(`[Room ${roomId}] ${player.name} left (${state.players.size}/${state.maxPlayers})`);

          // 다른 플레이어들에게 알림
          broadcast(playerActors, null, { type: 'PLAYER_LEFT', playerId: msg.playerId });

          // 게임 중이었다면 종료
          if (state.status === 'playing' && state.players.size < state.minPlayers) {
            state.status = 'finished';
            console.log(`[Room ${roomId}] Not enough players, game ended`);
            broadcast(playerActors, null, {
              type: 'GAME_ENDED',
              scores: new Map(Array.from(state.players.values()).map(p => [p.playerId, p.score])),
            });
          }

          // 룸이 비었으면 상태 리셋
          if (state.players.size === 0) {
            state.status = 'waiting';
            console.log(`[Room ${roomId}] Room is empty, resetting`);
          }

          return state;
        }

        case 'SET_READY': {
          const player = state.players.get(msg.playerId);
          if (!player || state.status !== 'waiting') return state;

          player.isReady = msg.ready;
          console.log(`[Room ${roomId}] ${player.name} is ${msg.ready ? 'ready' : 'not ready'}`);

          // 모든 플레이어에게 알림
          broadcast(playerActors, null, {
            type: 'PLAYER_READY',
            playerId: msg.playerId,
            ready: msg.ready,
          });

          // 모두 준비되었는지 확인
          checkStartCondition(state, ctx.self, playerActors);

          return state;
        }

        case 'START_GAME': {
          if (state.status !== 'waiting') return state;

          state.status = 'starting';
          console.log(`[Room ${roomId}] Game starting...`);

          // 카운트다운
          let countdown = 3;
          const countdownInterval = setInterval(() => {
            if (countdown > 0) {
              broadcast(playerActors, null, { type: 'GAME_STARTING', countdown });
              console.log(`[Room ${roomId}] Starting in ${countdown}...`);
              countdown--;
            } else {
              clearInterval(countdownInterval);
              state.status = 'playing';
              console.log(`[Room ${roomId}] Game started!`);
              broadcast(playerActors, null, { type: 'GAME_STARTED' });
            }
          }, 1000);

          return state;
        }

        case 'GAME_ACTION': {
          if (state.status !== 'playing') return state;

          const player = state.players.get(msg.playerId);
          if (!player) return state;

          console.log(`[Room ${roomId}] ${player.name} action: ${JSON.stringify(msg.action)}`);

          // 간단한 점수 시스템
          if (msg.action.type === 'SCORE') {
            player.score += msg.action.points;
            console.log(`[Room ${roomId}] ${player.name} score: ${player.score}`);
          }

          // 모든 플레이어에게 브로드캐스트
          broadcast(playerActors, null, {
            type: 'GAME_ACTION',
            playerId: msg.playerId,
            action: msg.action,
          });

          return state;
        }

        case 'END_GAME': {
          if (state.status !== 'playing') return state;

          state.status = 'finished';
          console.log(`[Room ${roomId}] Game ended! Winner: ${msg.winnerId || 'none'}`);

          const scores = new Map(
            Array.from(state.players.values()).map(p => [p.playerId, p.score])
          );

          broadcast(playerActors, null, {
            type: 'GAME_ENDED',
            winnerId: msg.winnerId,
            scores,
          });

          // 5초 후 대기 상태로 리셋
          setTimeout(() => {
            state.status = 'waiting';
            state.players.forEach(p => {
              p.isReady = false;
              p.score = 0;
            });
            console.log(`[Room ${roomId}] Room reset to waiting`);
          }, 5000);

          return state;
        }

        case 'GET_STATE': {
          return state;
        }

        default:
          return state;
      }
    }
  );
}

function broadcast(
  playerActors: Map<string, ActorRef<PlayerMessage>>,
  excludeId: string | null,
  msg: PlayerMessage
): void {
  playerActors.forEach((actor, id) => {
    if (id !== excludeId) {
      actor.send(msg);
    }
  });
}

function checkStartCondition(
  state: RoomState,
  roomActor: ActorRef<RoomMessage>,
  playerActors: Map<string, ActorRef<PlayerMessage>>
): void {
  if (state.players.size >= state.minPlayers) {
    const allReady = Array.from(state.players.values()).every(p => p.isReady);
    if (allReady) {
      console.log(`[Room ${state.roomId}] All players ready!`);
      roomActor.send({ type: 'START_GAME' });
    }
  }
}

// ============================================
// Player Actor
// ============================================

interface PlayerState {
  playerId: string;
  name: string;
  lastMessage?: PlayerMessage;
}

function createPlayerActor(
  system: ActorSystem,
  playerId: string,
  name: string
): ActorRef<PlayerMessage> {
  const initialState: PlayerState = {
    playerId,
    name,
  };

  return system.createActor<PlayerMessage, PlayerState>(
    `player-${playerId}`,
    initialState,
    (state, msg, ctx) => {
      state.lastMessage = msg;

      switch (msg.type) {
        case 'ROOM_STATE':
          console.log(`[Player ${name}] Received room state: ${msg.state.players.size} players`);
          break;

        case 'PLAYER_JOINED':
          console.log(`[Player ${name}] ${msg.player.name} joined the room`);
          break;

        case 'PLAYER_LEFT':
          console.log(`[Player ${name}] Player ${msg.playerId} left`);
          break;

        case 'PLAYER_READY':
          console.log(`[Player ${name}] Player ${msg.playerId} is ${msg.ready ? 'ready' : 'not ready'}`);
          break;

        case 'GAME_STARTING':
          console.log(`[Player ${name}] Game starting in ${msg.countdown}...`);
          break;

        case 'GAME_STARTED':
          console.log(`[Player ${name}] Game started!`);
          break;

        case 'GAME_ACTION':
          console.log(`[Player ${name}] Received action from ${msg.playerId}`);
          break;

        case 'GAME_ENDED':
          console.log(`[Player ${name}] Game ended! Winner: ${msg.winnerId || 'none'}`);
          break;
      }

      return state;
    }
  );
}

// ============================================
// 실행 예제
// ============================================

async function main() {
  console.log('=== Game Room Actor Pattern Demo ===\n');

  const system = new ActorSystem();

  // 게임 룸 생성
  const room = createRoomActor(system, '001');

  console.log('--- 1. Players Joining ---\n');

  room.send({ type: 'JOIN_ROOM', playerId: 'p1', playerName: 'Alice' });
  await delay(100);

  room.send({ type: 'JOIN_ROOM', playerId: 'p2', playerName: 'Bob' });
  await delay(100);

  room.send({ type: 'JOIN_ROOM', playerId: 'p3', playerName: 'Charlie' });
  await delay(100);

  console.log('\n--- 2. Players Getting Ready ---\n');

  room.send({ type: 'SET_READY', playerId: 'p1', ready: true });
  await delay(100);

  room.send({ type: 'SET_READY', playerId: 'p2', ready: true });
  await delay(100);

  // 마지막 플레이어가 준비되면 게임 시작
  room.send({ type: 'SET_READY', playerId: 'p3', ready: true });

  // 게임 시작 대기
  await delay(5000);

  console.log('\n--- 3. Game Actions ---\n');

  room.send({ type: 'GAME_ACTION', playerId: 'p1', action: { type: 'SCORE', points: 10 } });
  await delay(100);

  room.send({ type: 'GAME_ACTION', playerId: 'p2', action: { type: 'SCORE', points: 15 } });
  await delay(100);

  room.send({ type: 'GAME_ACTION', playerId: 'p1', action: { type: 'SCORE', points: 20 } });
  await delay(100);

  console.log('\n--- 4. Game End ---\n');

  room.send({ type: 'END_GAME', winnerId: 'p1' });
  await delay(1000);

  console.log('\n--- 5. Player Leaving ---\n');

  room.send({ type: 'LEAVE_ROOM', playerId: 'p3' });
  await delay(100);

  console.log('\n=== Demo Complete ===');
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(console.error);
