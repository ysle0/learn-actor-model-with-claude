# 게임룸 Actor 설계

> 멀티플레이어 게임의 핵심인 게임룸(방) Actor를 설계하고 구현하는 방법을 다룹니다.

## 한 줄 요약

**게임룸 Actor는 게임 세션의 상태, 참가자, 게임 로직을 캡슐화하여 동시성 안전하게 관리**

---

## 게임룸 Actor의 역할

```
┌─────────────────────────────────────────────────────────────────┐
│                  게임룸 Actor 책임 영역                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. 참가자 관리                                                  │
│     ─────────────                                               │
│     • 플레이어 입장/퇴장 처리                                    │
│     • 최대 인원 제한                                             │
│     • 호스트 권한 관리                                           │
│                                                                 │
│  2. 게임 상태 관리                                               │
│     ────────────────                                            │
│     • 대기 → 진행 중 → 종료 상태 전이                            │
│     • 게임 내 상태 (점수, 턴, 타이머 등)                         │
│     • 상태 동기화                                                │
│                                                                 │
│  3. 게임 로직 실행                                               │
│     ────────────────                                            │
│     • 플레이어 액션 검증 및 적용                                 │
│     • 규칙 적용 (턴 순서, 승패 판정)                             │
│     • 이벤트 발생 및 브로드캐스트                                │
│                                                                 │
│  4. 통신 허브                                                    │
│     ───────────                                                 │
│     • 플레이어 간 메시지 중계                                    │
│     • 상태 업데이트 브로드캐스트                                  │
│     • 외부 서비스 연동 (랭킹, 통계 등)                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 기본 설계

### 상태 정의

```csharp
// 게임룸 상태
public enum RoomState
{
    Waiting,      // 대기 중 (플레이어 모집)
    Starting,     // 시작 준비 중 (카운트다운)
    InProgress,   // 게임 진행 중
    Paused,       // 일시 정지
    Finished,     // 게임 종료
    Closing       // 방 닫는 중
}

// 게임룸 데이터
public class GameRoomData
{
    public string RoomId { get; set; }
    public string RoomName { get; set; }
    public RoomState State { get; set; }
    public int MaxPlayers { get; set; }
    public string HostPlayerId { get; set; }
    public Dictionary<string, PlayerInfo> Players { get; set; }
    public GameState GameState { get; set; }
    public RoomSettings Settings { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? StartedAt { get; set; }
}
```

### 메시지 정의

```csharp
// 게임룸으로 들어오는 메시지들
public interface IGameRoomMessage { }

// 플레이어 관련
public record JoinRoom(string PlayerId, string PlayerName) : IGameRoomMessage;
public record LeaveRoom(string PlayerId) : IGameRoomMessage;
public record KickPlayer(string RequesterId, string TargetId) : IGameRoomMessage;

// 게임 진행 관련
public record StartGame(string RequesterId) : IGameRoomMessage;
public record PlayerAction(string PlayerId, GameAction Action) : IGameRoomMessage;
public record PauseGame(string RequesterId) : IGameRoomMessage;
public record ResumeGame(string RequesterId) : IGameRoomMessage;

// 채팅
public record ChatMessage(string PlayerId, string Message) : IGameRoomMessage;

// 시스템
public record Heartbeat() : IGameRoomMessage;
public record GetRoomInfo() : IGameRoomMessage;
```

---

## Orleans 구현 예시

### Grain 인터페이스

```csharp
public interface IGameRoomGrain : IGrainWithStringKey
{
    // 플레이어 관리
    Task<JoinResult> Join(string playerId, string playerName);
    Task Leave(string playerId);
    Task<bool> Kick(string requesterId, string targetId);

    // 게임 진행
    Task<bool> StartGame(string requesterId);
    Task<ActionResult> ProcessAction(string playerId, GameAction action);
    Task Pause(string requesterId);
    Task Resume(string requesterId);

    // 조회
    Task<RoomInfo> GetInfo();
    Task<GameState> GetGameState();

    // 구독
    Task Subscribe(IGameRoomObserver observer);
    Task Unsubscribe(IGameRoomObserver observer);
}

// Observer 인터페이스 (클라이언트 알림용)
public interface IGameRoomObserver : IGrainObserver
{
    void OnPlayerJoined(string playerId, string playerName);
    void OnPlayerLeft(string playerId);
    void OnGameStarted();
    void OnGameStateChanged(GameState state);
    void OnGameEnded(GameResult result);
    void OnChatMessage(string playerId, string message);
}
```

### Grain 구현

```csharp
public class GameRoomGrain : Grain, IGameRoomGrain
{
    private readonly IPersistentState<GameRoomData> _state;
    private readonly ObserverManager<IGameRoomObserver> _observers;
    private IDisposable _gameTimer;

    public GameRoomGrain(
        [PersistentState("room", "gameStore")] IPersistentState<GameRoomData> state)
    {
        _state = state;
        _observers = new ObserverManager<IGameRoomObserver>(
            TimeSpan.FromMinutes(5), // 구독 만료 시간
            this.GetLogger()
        );
    }

    public override async Task OnActivateAsync(CancellationToken token)
    {
        // 첫 활성화 시 초기화
        if (_state.State == null)
        {
            _state.State = new GameRoomData
            {
                RoomId = this.GetPrimaryKeyString(),
                State = RoomState.Waiting,
                MaxPlayers = 4,
                Players = new Dictionary<string, PlayerInfo>(),
                CreatedAt = DateTime.UtcNow
            };
            await _state.WriteStateAsync();
        }

        await base.OnActivateAsync(token);
    }

    // ─────────────────────────────────────────────────────────
    // 플레이어 관리
    // ─────────────────────────────────────────────────────────

    public async Task<JoinResult> Join(string playerId, string playerName)
    {
        var room = _state.State;

        // 검증
        if (room.State != RoomState.Waiting)
            return JoinResult.GameAlreadyStarted;

        if (room.Players.Count >= room.MaxPlayers)
            return JoinResult.RoomFull;

        if (room.Players.ContainsKey(playerId))
            return JoinResult.AlreadyJoined;

        // 입장 처리
        var playerInfo = new PlayerInfo
        {
            PlayerId = playerId,
            PlayerName = playerName,
            JoinedAt = DateTime.UtcNow,
            IsReady = false
        };

        room.Players[playerId] = playerInfo;

        // 첫 번째 플레이어가 호스트
        if (room.Players.Count == 1)
            room.HostPlayerId = playerId;

        await _state.WriteStateAsync();

        // 다른 플레이어들에게 알림
        await _observers.Notify(o => o.OnPlayerJoined(playerId, playerName));

        return JoinResult.Success;
    }

    public async Task Leave(string playerId)
    {
        var room = _state.State;

        if (!room.Players.ContainsKey(playerId))
            return;

        room.Players.Remove(playerId);

        // 호스트가 나가면 다른 사람에게 이전
        if (room.HostPlayerId == playerId && room.Players.Any())
        {
            room.HostPlayerId = room.Players.Keys.First();
        }

        await _state.WriteStateAsync();
        await _observers.Notify(o => o.OnPlayerLeft(playerId));

        // 게임 중에 나가면 처리
        if (room.State == RoomState.InProgress)
        {
            await HandlePlayerLeftDuringGame(playerId);
        }

        // 방이 비면 정리
        if (room.Players.Count == 0)
        {
            await ScheduleRoomCleanup();
        }
    }

    // ─────────────────────────────────────────────────────────
    // 게임 진행
    // ─────────────────────────────────────────────────────────

    public async Task<bool> StartGame(string requesterId)
    {
        var room = _state.State;

        // 권한 검증
        if (room.HostPlayerId != requesterId)
            return false;

        if (room.State != RoomState.Waiting)
            return false;

        if (room.Players.Count < 2) // 최소 인원
            return false;

        // 게임 시작
        room.State = RoomState.InProgress;
        room.StartedAt = DateTime.UtcNow;
        room.GameState = InitializeGameState(room.Players.Keys.ToList());

        await _state.WriteStateAsync();

        // 게임 타이머 시작 (필요시)
        StartGameTimer();

        // 알림
        await _observers.Notify(o => o.OnGameStarted());
        await _observers.Notify(o => o.OnGameStateChanged(room.GameState));

        return true;
    }

    public async Task<ActionResult> ProcessAction(string playerId, GameAction action)
    {
        var room = _state.State;

        // 검증
        if (room.State != RoomState.InProgress)
            return ActionResult.InvalidState;

        if (!room.Players.ContainsKey(playerId))
            return ActionResult.PlayerNotInRoom;

        // 게임 로직에서 액션 검증 및 적용
        var result = GameLogic.ValidateAndApply(room.GameState, playerId, action);

        if (result.IsSuccess)
        {
            await _state.WriteStateAsync();
            await _observers.Notify(o => o.OnGameStateChanged(room.GameState));

            // 게임 종료 체크
            if (GameLogic.IsGameOver(room.GameState))
            {
                await EndGame();
            }
        }

        return result;
    }

    private async Task EndGame()
    {
        var room = _state.State;
        room.State = RoomState.Finished;

        var result = GameLogic.CalculateResult(room.GameState);

        await _state.WriteStateAsync();
        await _observers.Notify(o => o.OnGameEnded(result));

        // 통계 서비스에 결과 전송
        var statsGrain = GrainFactory.GetGrain<IGameStatsGrain>(0);
        await statsGrain.RecordGameResult(room.RoomId, result);

        // 일정 시간 후 방 정리
        RegisterTimer(
            _ => CleanupRoom(),
            null,
            TimeSpan.FromMinutes(1),
            TimeSpan.MaxValue
        );
    }

    // ─────────────────────────────────────────────────────────
    // 유틸리티
    // ─────────────────────────────────────────────────────────

    private GameState InitializeGameState(List<string> playerIds)
    {
        return new GameState
        {
            CurrentTurn = 0,
            CurrentPlayerId = playerIds[0],
            PlayerStates = playerIds.ToDictionary(
                id => id,
                id => new PlayerGameState { Score = 0 }
            ),
            TurnTimeLimit = TimeSpan.FromSeconds(30)
        };
    }

    private void StartGameTimer()
    {
        _gameTimer = RegisterTimer(
            OnGameTick,
            null,
            TimeSpan.FromSeconds(1),
            TimeSpan.FromSeconds(1)
        );
    }

    private async Task OnGameTick(object _)
    {
        var room = _state.State;
        if (room.State != RoomState.InProgress)
            return;

        // 턴 타이머 체크
        room.GameState.TurnTimeRemaining -= TimeSpan.FromSeconds(1);

        if (room.GameState.TurnTimeRemaining <= TimeSpan.Zero)
        {
            // 시간 초과 처리
            await ProcessTurnTimeout();
        }
    }
}
```

---

## C++ CAF 구현 예시

```cpp
#include <caf/all.hpp>
#include <unordered_map>
#include <string>

using namespace caf;

// 메시지 정의
struct join_room { std::string player_id; std::string player_name; };
struct leave_room { std::string player_id; };
struct start_game { std::string requester_id; };
struct player_action { std::string player_id; game_action action; };
struct get_room_info {};

CAF_BEGIN_TYPE_ID_BLOCK(game_room, first_custom_type_id)
  CAF_ADD_TYPE_ID(game_room, (join_room))
  CAF_ADD_TYPE_ID(game_room, (leave_room))
  CAF_ADD_TYPE_ID(game_room, (start_game))
  CAF_ADD_TYPE_ID(game_room, (player_action))
  CAF_ADD_TYPE_ID(game_room, (get_room_info))
CAF_END_TYPE_ID_BLOCK(game_room)

// 게임룸 상태
enum class room_state { waiting, in_progress, finished };

struct player_info {
    std::string player_id;
    std::string player_name;
    bool is_ready = false;
};

struct game_room_state {
    std::string room_id;
    room_state state = room_state::waiting;
    int max_players = 4;
    std::string host_player_id;
    std::unordered_map<std::string, player_info> players;
    game_state game;
    std::vector<actor> observers;
};

// 게임룸 Actor
behavior game_room_actor(stateful_actor<game_room_state>* self,
                         const std::string& room_id) {
    self->state.room_id = room_id;

    return {
        // 입장
        [=](join_room msg) -> result<join_result> {
            auto& s = self->state;

            if (s.state != room_state::waiting)
                return join_result::game_already_started;

            if (s.players.size() >= s.max_players)
                return join_result::room_full;

            if (s.players.count(msg.player_id) > 0)
                return join_result::already_joined;

            // 입장 처리
            s.players[msg.player_id] = player_info{
                msg.player_id, msg.player_name, false
            };

            if (s.players.size() == 1)
                s.host_player_id = msg.player_id;

            // 브로드캐스트
            for (auto& observer : s.observers) {
                self->send(observer, player_joined_event{
                    msg.player_id, msg.player_name
                });
            }

            return join_result::success;
        },

        // 퇴장
        [=](leave_room msg) {
            auto& s = self->state;

            if (s.players.count(msg.player_id) == 0)
                return;

            s.players.erase(msg.player_id);

            // 호스트 이전
            if (s.host_player_id == msg.player_id && !s.players.empty()) {
                s.host_player_id = s.players.begin()->first;
            }

            // 브로드캐스트
            for (auto& observer : s.observers) {
                self->send(observer, player_left_event{msg.player_id});
            }

            // 빈 방 정리
            if (s.players.empty()) {
                self->quit();
            }
        },

        // 게임 시작
        [=](start_game msg) -> bool {
            auto& s = self->state;

            if (s.host_player_id != msg.requester_id)
                return false;

            if (s.state != room_state::waiting)
                return false;

            if (s.players.size() < 2)
                return false;

            // 게임 시작
            s.state = room_state::in_progress;
            s.game = initialize_game_state(s.players);

            // 브로드캐스트
            for (auto& observer : s.observers) {
                self->send(observer, game_started_event{});
                self->send(observer, game_state_event{s.game});
            }

            // 게임 타이머 시작
            self->delayed_send(self, std::chrono::seconds(1), tick_atom_v);

            return true;
        },

        // 플레이어 액션
        [=](player_action msg) -> action_result {
            auto& s = self->state;

            if (s.state != room_state::in_progress)
                return action_result::invalid_state;

            auto result = validate_and_apply(s.game, msg.player_id, msg.action);

            if (result.success) {
                for (auto& observer : s.observers) {
                    self->send(observer, game_state_event{s.game});
                }

                if (is_game_over(s.game)) {
                    end_game(self);
                }
            }

            return result;
        },

        // 정보 조회
        [=](get_room_info) -> room_info {
            auto& s = self->state;
            return room_info{
                s.room_id,
                static_cast<int>(s.players.size()),
                s.max_players,
                s.state
            };
        },

        // 게임 틱
        [=](tick_atom) {
            auto& s = self->state;
            if (s.state != room_state::in_progress)
                return;

            // 턴 타이머 감소
            s.game.turn_time_remaining -= 1;

            if (s.game.turn_time_remaining <= 0) {
                process_turn_timeout(self);
            }

            // 다음 틱 예약
            self->delayed_send(self, std::chrono::seconds(1), tick_atom_v);
        }
    };
}
```

---

## TypeScript/Proto.Actor 구현 예시

```typescript
import { Actor, Context, Message, PID } from 'protoactor';

// 메시지 타입
interface JoinRoom {
    type: 'JOIN';
    playerId: string;
    playerName: string;
}

interface LeaveRoom {
    type: 'LEAVE';
    playerId: string;
}

interface StartGame {
    type: 'START';
    requesterId: string;
}

interface PlayerAction {
    type: 'ACTION';
    playerId: string;
    action: GameAction;
}

type GameRoomMessage = JoinRoom | LeaveRoom | StartGame | PlayerAction;

// 게임룸 Actor
class GameRoomActor extends Actor {
    private state: RoomState = 'waiting';
    private players: Map<string, PlayerInfo> = new Map();
    private hostPlayerId: string | null = null;
    private gameState: GameState | null = null;
    private observers: Set<PID> = new Set();
    private maxPlayers = 4;

    async receive(context: Context, message: Message): Promise<void> {
        const msg = message as GameRoomMessage;

        switch (msg.type) {
            case 'JOIN':
                await this.handleJoin(context, msg);
                break;
            case 'LEAVE':
                await this.handleLeave(context, msg);
                break;
            case 'START':
                await this.handleStart(context, msg);
                break;
            case 'ACTION':
                await this.handleAction(context, msg);
                break;
        }
    }

    private async handleJoin(context: Context, msg: JoinRoom): Promise<void> {
        // 검증
        if (this.state !== 'waiting') {
            context.respond({ success: false, reason: 'GAME_STARTED' });
            return;
        }

        if (this.players.size >= this.maxPlayers) {
            context.respond({ success: false, reason: 'ROOM_FULL' });
            return;
        }

        // 입장
        this.players.set(msg.playerId, {
            playerId: msg.playerId,
            playerName: msg.playerName,
            isReady: false
        });

        if (this.players.size === 1) {
            this.hostPlayerId = msg.playerId;
        }

        // 브로드캐스트
        await this.broadcast({
            type: 'PLAYER_JOINED',
            playerId: msg.playerId,
            playerName: msg.playerName
        });

        context.respond({ success: true });
    }

    private async handleStart(context: Context, msg: StartGame): Promise<void> {
        if (this.hostPlayerId !== msg.requesterId) {
            context.respond({ success: false, reason: 'NOT_HOST' });
            return;
        }

        if (this.players.size < 2) {
            context.respond({ success: false, reason: 'NOT_ENOUGH_PLAYERS' });
            return;
        }

        this.state = 'in_progress';
        this.gameState = this.initializeGame();

        await this.broadcast({ type: 'GAME_STARTED' });
        await this.broadcast({ type: 'GAME_STATE', state: this.gameState });

        // 게임 타이머 시작
        this.startGameTimer(context);

        context.respond({ success: true });
    }

    private async broadcast(message: any): Promise<void> {
        for (const observer of this.observers) {
            observer.tell(message);
        }
    }

    private initializeGame(): GameState {
        const playerIds = Array.from(this.players.keys());
        return {
            currentTurn: 0,
            currentPlayerId: playerIds[0],
            playerStates: new Map(
                playerIds.map(id => [id, { score: 0 }])
            ),
            turnTimeRemaining: 30
        };
    }

    private startGameTimer(context: Context): void {
        setInterval(() => {
            if (this.state !== 'in_progress' || !this.gameState) return;

            this.gameState.turnTimeRemaining--;

            if (this.gameState.turnTimeRemaining <= 0) {
                this.handleTurnTimeout();
            }
        }, 1000);
    }
}
```

---

## 설계 패턴 및 고려사항

### 1. 상태 머신

```
┌─────────────────────────────────────────────────────────────────┐
│                    게임룸 상태 전이                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ┌─────────┐   시작 요청   ┌──────────┐                        │
│   │ Waiting │─────────────▶│ Starting │                        │
│   └────┬────┘              └────┬─────┘                        │
│        │                        │                              │
│        │ 플레이어               │ 카운트다운                    │
│        │ 모두 퇴장              │ 완료                          │
│        ▼                        ▼                              │
│   ┌─────────┐              ┌──────────┐                        │
│   │ Closing │◀─────────────│InProgress│◀──────┐                │
│   └─────────┘   시간 초과   └────┬─────┘       │                │
│        ▲                        │              │                │
│        │                        │ 일시정지     │ 재개           │
│        │                        ▼              │                │
│        │                   ┌─────────┐        │                │
│        │                   │ Paused  │────────┘                │
│        │                   └─────────┘                         │
│        │                        │                              │
│        │    게임 종료           │                              │
│        │◀───────────────────────┘                              │
│        │                                                       │
│   ┌────┴────┐                                                  │
│   │Finished │                                                  │
│   └─────────┘                                                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 2. 브로드캐스트 최적화

```csharp
// 비효율: 개별 전송
foreach (var player in players)
{
    await player.Send(new StateUpdate(state));
}

// 효율: 배치 전송
var batch = new StateBatch(updates);
await BroadcastAsync(batch);

// 더 효율: 델타 압축
var delta = GameState.CalculateDelta(previousState, currentState);
if (delta.HasChanges)
{
    await BroadcastAsync(new DeltaUpdate(delta));
}
```

### 3. 동시성 안전성

```
Actor 모델의 장점:
────────────────
• 단일 스레드 처리: 게임룸 내 모든 메시지는 순차 처리
• 경쟁 조건 없음: 상태 접근에 락 불필요
• 예측 가능한 동작: 메시지 순서대로 처리

주의사항:
────────
• 비동기 작업(DB, 외부 API) 후 상태 체크 필요
• Timer 콜백에서 상태 변경 시 주의
```

### 4. 메모리 관리

```csharp
// Orleans: 비활성 Grain 자동 비활성화
public override async Task OnDeactivateAsync(
    DeactivationReason reason,
    CancellationToken token)
{
    // 진행 중인 게임 상태 저장
    if (_state.State.State == RoomState.InProgress)
    {
        await _state.WriteStateAsync();
    }

    // 타이머 정리
    _gameTimer?.Dispose();

    await base.OnDeactivateAsync(reason, token);
}
```

---

## 테스트 전략

```csharp
[Test]
public async Task Should_Allow_Join_When_Room_Not_Full()
{
    // Arrange
    var room = await GetGrain<IGameRoomGrain>("test-room");

    // Act
    var result = await room.Join("player1", "Player 1");

    // Assert
    Assert.AreEqual(JoinResult.Success, result);
    var info = await room.GetInfo();
    Assert.AreEqual(1, info.PlayerCount);
}

[Test]
public async Task Should_Reject_Join_When_Room_Full()
{
    // Arrange
    var room = await GetGrain<IGameRoomGrain>("test-room");
    for (int i = 0; i < 4; i++)
    {
        await room.Join($"player{i}", $"Player {i}");
    }

    // Act
    var result = await room.Join("player5", "Player 5");

    // Assert
    Assert.AreEqual(JoinResult.RoomFull, result);
}

[Test]
public async Task Should_Broadcast_State_On_Action()
{
    // Arrange
    var room = await GetGrain<IGameRoomGrain>("test-room");
    var observer = new TestObserver();
    await room.Subscribe(observer);

    await room.Join("player1", "P1");
    await room.Join("player2", "P2");
    await room.StartGame("player1");

    // Act
    await room.ProcessAction("player1", new MoveAction(1, 2));

    // Assert
    Assert.IsTrue(observer.ReceivedStateUpdate);
}
```

---

## 다음 단계

- [player-actor.md](./player-actor.md) - 플레이어 Actor 설계
- [state-persistence.md](./state-persistence.md) - 상태 영속화 전략
- [../07-realtime-game/README.md](../07-realtime-game/README.md) - 실시간 게임 적합성
