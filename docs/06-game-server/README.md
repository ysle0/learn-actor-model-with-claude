# 06. Game Server - 게임 서버에서의 Actor Model

> 게임 서버에 Actor Model을 적용하는 방법과 실제 사례를 알아봅니다.

## 한 줄 요약

**게임의 각 엔티티(플레이어, 몬스터, 아이템, 방)를 Actor로 모델링하여 동시성과 확장성을 확보**

---

## 왜 게임 서버에 Actor Model인가?

```
┌─────────────────────────────────────────────────────────────────┐
│                 게임 서버 요구사항과 Actor Model                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  게임 서버 특성              Actor Model 장점                   │
│  ───────────────            ──────────────────                  │
│  • 수천~수만 동시 접속   →   • 수백만 Actor 동시 실행 가능       │
│  • 실시간 상호작용       →   • 비동기 메시지로 빠른 응답         │
│  • 복잡한 상태 관리      →   • Actor별 격리된 상태              │
│  • 서버 확장 필요        →   • 위치 투명한 분산 처리            │
│  • 24/7 가용성          →   • Supervision으로 장애 복구         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 게임 엔티티 → Actor 매핑

### 기본 매핑 패턴

```
게임 개념                      Actor
──────────────────────────────────────────
플레이어 (Player)         →   PlayerActor
게임 방 (Room/Match)      →   GameRoomActor
몬스터/NPC               →   NPCActor
아이템                   →   ItemActor (또는 상태로 관리)
길드/클랜               →   GuildActor
채팅 채널               →   ChatChannelActor
매치메이킹              →   MatchmakerActor
```

### Actor 계층 구조 예시

```
                        /GameServer
                             │
          ┌──────────────────┼──────────────────┐
          │                  │                  │
     /WorldManager     /MatchMaker        /ChatService
          │                  │                  │
    ┌─────┼─────┐      ┌─────┼─────┐     ┌─────┼─────┐
    │     │     │      │     │     │     │     │     │
 /Zone1 /Zone2 ...  /Queue1 /Queue2   /Global /Guild ...
    │
    ├── /Player_001
    ├── /Player_002
    ├── /Monster_001
    └── /NPC_001
```

---

## 실제 사용 사례

### 1. Halo 4/5 (Microsoft Orleans)

```
┌─────────────────────────────────────────────────────────────┐
│                    Halo - Orleans 아키텍처                   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  사용된 Grain (Virtual Actor) 타입:                          │
│  ──────────────────────────────                             │
│  • PlayerGrain: 플레이어 상태, 인벤토리, 통계                │
│  • GameSessionGrain: 매치 세션 관리                         │
│  • PresenceGrain: 온라인 상태 관리                          │
│  • LeaderboardGrain: 랭킹 시스템                            │
│  • StatisticsGrain: 게임 통계                               │
│                                                             │
│  결과:                                                      │
│  ──────                                                     │
│  • 수백만 동시 사용자 처리                                   │
│  • 자동 확장/축소                                           │
│  • 높은 가용성 달성                                         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2. EVE Online (Stackless Python)

```
┌─────────────────────────────────────────────────────────────┐
│                EVE Online - Time Dilation                   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  문제: 한 지역에 수천 명의 플레이어 집중                     │
│                                                             │
│  해결책: Time Dilation (시간 희석)                          │
│  ────────────────────────────────                           │
│  • 부하 증가 시 게임 내 시간 속도 감소                       │
│  • 실제 1초 = 게임 내 0.1초 (10% TiDi)                      │
│  • 서버가 모든 행동을 처리할 시간 확보                       │
│                                                             │
│  Actor 활용:                                                │
│  ──────────                                                 │
│  • 각 함선 = Actor (Stackless Tasklet)                      │
│  • 태양계 = Actor (Zone 관리)                               │
│  • 비동기 처리로 대규모 전투 지원                            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 게임룸 Actor 설계

### 기본 구조

```csharp
// Orleans 예시
public interface IGameRoomGrain : IGrainWithStringKey
{
    Task<bool> Join(string playerId);
    Task Leave(string playerId);
    Task<GameState> GetState();
    Task ProcessAction(string playerId, GameAction action);
}

public class GameRoomGrain : Grain, IGameRoomGrain
{
    private readonly HashSet<string> _players = new();
    private GameState _state = new();

    public Task<bool> Join(string playerId)
    {
        if (_players.Count >= MaxPlayers) return Task.FromResult(false);

        _players.Add(playerId);
        BroadcastToPlayers(new PlayerJoined(playerId));
        return Task.FromResult(true);
    }

    public Task ProcessAction(string playerId, GameAction action)
    {
        // 게임 로직 처리
        _state = GameLogic.Apply(_state, action);

        // 모든 플레이어에게 상태 브로드캐스트
        BroadcastToPlayers(new StateUpdate(_state));
        return Task.CompletedTask;
    }

    private void BroadcastToPlayers(IGameEvent evt)
    {
        foreach (var playerId in _players)
        {
            var playerGrain = GrainFactory.GetGrain<IPlayerGrain>(playerId);
            playerGrain.ReceiveEvent(evt);
        }
    }
}
```

### C++ CAF 예시

```cpp
// 게임룸 Actor 상태
struct game_room_state {
    std::set<actor> players;
    game_state state;
    int max_players = 10;
};

// 메시지 타입
using join_atom = atom_constant<atom("join")>;
using leave_atom = atom_constant<atom("leave")>;
using action_atom = atom_constant<atom("action")>;

behavior game_room(stateful_actor<game_room_state>* self) {
    return {
        [=](join_atom, actor player) -> bool {
            if (self->state.players.size() >= self->state.max_players) {
                return false;
            }
            self->state.players.insert(player);
            broadcast(self, player_joined{player});
            return true;
        },
        [=](action_atom, actor player, game_action action) {
            self->state.state = apply_action(self->state.state, action);
            broadcast(self, state_update{self->state.state});
        },
        [=](leave_atom, actor player) {
            self->state.players.erase(player);
            broadcast(self, player_left{player});
        }
    };
}
```

---

## MMORPG 아키텍처 패턴

### Zone/Shard 기반 분산

```
┌─────────────────────────────────────────────────────────────────┐
│                    MMORPG Zone 아키텍처                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│                        World Manager                            │
│                             │                                   │
│         ┌───────────────────┼───────────────────┐              │
│         │                   │                   │              │
│    ┌────┴────┐        ┌────┴────┐        ┌────┴────┐          │
│    │ Zone 1  │        │ Zone 2  │        │ Zone 3  │          │
│    │ (초원)   │◀──────▶│ (던전)   │◀──────▶│ (도시)   │          │
│    └────┬────┘        └────┬────┘        └────┬────┘          │
│         │                  │                  │                │
│    ┌────┴────┐        ┌────┴────┐        ┌────┴────┐          │
│    │ Players │        │ Players │        │ Players │          │
│    │ Monsters│        │ Monsters│        │ NPCs    │          │
│    │ Items   │        │ Items   │        │ Shops   │          │
│    └─────────┘        └─────────┘        └─────────┘          │
│                                                                 │
│  Zone 간 이동: 메시지로 플레이어 Actor 상태 전달                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 관심 영역 (Area of Interest) 관리

```cpp
// 플레이어 주변 일정 범위만 업데이트
struct area_of_interest_actor {
    static constexpr float VIEW_RANGE = 100.0f;

    void on_player_move(player_id id, position new_pos) {
        auto& player = players[id];
        auto old_neighbors = get_neighbors(player.pos, VIEW_RANGE);
        auto new_neighbors = get_neighbors(new_pos, VIEW_RANGE);

        // 시야에서 벗어난 엔티티
        for (auto& entity : difference(old_neighbors, new_neighbors)) {
            player.send(entity_disappeared{entity});
        }

        // 새로 시야에 들어온 엔티티
        for (auto& entity : difference(new_neighbors, old_neighbors)) {
            player.send(entity_appeared{entity});
        }

        player.pos = new_pos;
    }
};
```

---

## 성능 최적화 팁

### 1. Actor 세분화 수준 결정

```
❌ 너무 세분화: 모든 총알이 Actor
   → 메시지 오버헤드 폭발

✅ 적절한 세분화: Zone이 총알 관리
   → 물리 시뮬레이션은 Zone Actor 내부에서

❌ 너무 조대화: 전체 월드가 하나의 Actor
   → 병렬성 상실
```

### 2. 메시지 배치 처리

```csharp
// 개별 메시지 대신 배치
public class PlayerGrain : Grain
{
    private List<GameEvent> _eventBuffer = new();
    private IDisposable _flushTimer;

    public override Task OnActivateAsync()
    {
        // 50ms마다 버퍼 플러시
        _flushTimer = RegisterTimer(
            FlushEvents,
            null,
            TimeSpan.FromMilliseconds(50),
            TimeSpan.FromMilliseconds(50)
        );
        return base.OnActivateAsync();
    }

    private Task FlushEvents(object _)
    {
        if (_eventBuffer.Any())
        {
            SendToClient(new EventBatch(_eventBuffer));
            _eventBuffer.Clear();
        }
        return Task.CompletedTask;
    }
}
```

---

## 심화 문서

| 주제 | 설명 | 링크 |
|------|------|------|
| 사례 연구 | Halo, EVE 상세 분석 | [use-cases.md](./use-cases.md) |
| 아키텍처 패턴 | 게임 서버 설계 패턴 | [architecture-patterns.md](./architecture-patterns.md) |
| 게임룸 설계 | 상세 구현 가이드 | [game-room-actor.md](./game-room-actor.md) |
| 상태 영속화 | 저장/복원 전략 | [state-persistence.md](./state-persistence.md) |

---

## 다음 단계

- [07. Real-time Game](../07-realtime-game/README.md) - 실시간 게임 적합성 분석
- [08. Web Server](../08-web-server/README.md) - 비실시간 서버 비교
