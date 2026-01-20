# 게임 프레임워크 분석

> Actor Model을 활용하는 게임 서버 프레임워크들의 분석 가이드입니다.

## 개요

```
┌─────────────────────────────────────────────────────────────────┐
│              게임 서버 Actor 프레임워크 생태계                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  플랫폼              프레임워크         특징                     │
│  ──────              ──────────         ────                     │
│  JVM (Java/Kotlin)   Orbit              EA 개발, Virtual Actor  │
│  .NET                Orleans            MS 개발, Halo 검증       │
│  Cloud               SpatialOS          대규모 MMO, 멀티서버    │
│  C++                 CAF                고성능, 네이티브         │
│  Go                  Proto.Actor        경량, 크로스 플랫폼     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Orbit (EA Games)

```
📦 orbit/orbit
🌐 https://github.com/orbit/orbit
⭐ 1.8k+ stars
📝 Kotlin/Java
📄 BSD-3 License
🏢 Electronic Arts
```

### 아키텍처

```
┌─────────────────────────────────────────────────────────────────┐
│                    Orbit 아키텍처                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐      ┌─────────────┐      ┌─────────────┐    │
│  │   Client    │      │   Client    │      │   Client    │    │
│  └──────┬──────┘      └──────┬──────┘      └──────┬──────┘    │
│         │                    │                    │            │
│         └────────────────────┼────────────────────┘            │
│                              │                                  │
│                    ┌─────────▼─────────┐                       │
│                    │   Orbit Server    │                       │
│                    │  (Virtual Actor   │                       │
│                    │   Container)      │                       │
│                    └─────────┬─────────┘                       │
│                              │                                  │
│         ┌────────────────────┼────────────────────┐            │
│         │                    │                    │            │
│  ┌──────▼──────┐      ┌──────▼──────┐      ┌──────▼──────┐    │
│  │ Actor Node 1│      │ Actor Node 2│      │ Actor Node 3│    │
│  │ [Player]    │      │ [Match]     │      │ [Inventory] │    │
│  │ [Inventory] │      │ [Chat]      │      │ [Match]     │    │
│  └─────────────┘      └─────────────┘      └─────────────┘    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 핵심 코드

```kotlin
// Orbit Actor 정의
interface Player : ActorWithStringKey {
    suspend fun getProfile(): PlayerProfile
    suspend fun updatePosition(position: Position)
    suspend fun joinMatch(matchId: String): JoinResult
}

class PlayerImpl : AbstractActor(), Player {
    private var profile: PlayerProfile? = null
    private var currentMatch: String? = null

    override suspend fun getProfile(): PlayerProfile {
        return profile ?: loadProfile().also { profile = it }
    }

    override suspend fun updatePosition(position: Position) {
        // 현재 매치에 위치 브로드캐스트
        currentMatch?.let { matchId ->
            val match = ActorProxyFactory.createProxy<Match>(matchId)
            match.broadcastPosition(context.reference.key, position)
        }
    }

    override suspend fun joinMatch(matchId: String): JoinResult {
        val match = ActorProxyFactory.createProxy<Match>(matchId)
        val result = match.addPlayer(context.reference.key, profile!!)

        if (result.success) {
            currentMatch = matchId
        }
        return result
    }

    private suspend fun loadProfile(): PlayerProfile {
        // DB에서 로드
        return database.loadPlayer(context.reference.key)
    }
}

// 매치 Actor
interface Match : ActorWithStringKey {
    suspend fun addPlayer(playerId: String, profile: PlayerProfile): JoinResult
    suspend fun broadcastPosition(playerId: String, position: Position)
    suspend fun getState(): MatchState
}

class MatchImpl : AbstractActor(), Match {
    private val players = mutableMapOf<String, PlayerInfo>()
    private var gameState = MatchState.WAITING

    override suspend fun addPlayer(playerId: String, profile: PlayerProfile): JoinResult {
        if (players.size >= MAX_PLAYERS) {
            return JoinResult(false, "Match is full")
        }

        players[playerId] = PlayerInfo(profile, Position.SPAWN)

        if (players.size >= MIN_PLAYERS && gameState == MatchState.WAITING) {
            startMatch()
        }

        return JoinResult(true, "Joined successfully")
    }

    override suspend fun broadcastPosition(playerId: String, position: Position) {
        players[playerId]?.position = position

        // 다른 플레이어들에게 브로드캐스트
        players.keys.filter { it != playerId }.forEach { otherId ->
            val player = ActorProxyFactory.createProxy<Player>(otherId)
            player.receivePositionUpdate(playerId, position)
        }
    }
}
```

### Orbit 설정

```kotlin
// 서버 설정
val orbitServer = OrbitServer(
    OrbitServerConfig(
        serverInfo = ServerInfo(
            url = "localhost:50056",
            port = 50056
        ),
        addressableLeaseDurationSeconds = 600,
        nodeLeaseDurationSeconds = 60,
        tickRate = 100
    )
)

// 클라이언트 설정
val orbitClient = OrbitClient(
    OrbitClientConfig(
        grpcEndpoint = "localhost:50056",
        packages = listOf("com.mygame.actors"),
        addressableTTL = 10.minutes
    )
)

orbitClient.start().join()
```

---

## SpatialOS (Improbable)

```
🌐 https://improbable.io/spatialos
📝 Unity / Unreal GDK
🏢 Improbable
```

### Entity-Component-Worker 아키텍처

```
┌─────────────────────────────────────────────────────────────────┐
│              SpatialOS ECW 아키텍처                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  전통적 아키텍처:                                                │
│  ┌─────────────────────────────────────────┐                   │
│  │         Single Game Server              │                   │
│  │   [Physics][AI][Logic][Network]         │                   │
│  │        (확장 한계)                       │                   │
│  └─────────────────────────────────────────┘                   │
│                                                                 │
│  SpatialOS ECW:                                                │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                  SpatialOS Runtime                       │   │
│  │  ┌─────────────────────────────────────────────────┐    │   │
│  │  │              Entity Database                     │    │   │
│  │  │  Entity 1: [Position][Health][Inventory]        │    │   │
│  │  │  Entity 2: [Position][AI][Combat]               │    │   │
│  │  │  Entity N: [Position][Physics]                  │    │   │
│  │  └─────────────────────────────────────────────────┘    │   │
│  │                         │                                │   │
│  │    ┌────────────────────┼────────────────────┐          │   │
│  │    │                    │                    │          │   │
│  │  ┌─▼──────────┐  ┌──────▼─────┐  ┌──────────▼─┐        │   │
│  │  │Logic Worker│  │Physics     │  │AI Worker   │        │   │
│  │  │(Zone A)    │  │Worker      │  │            │        │   │
│  │  └────────────┘  └────────────┘  └────────────┘        │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  결과: 1000+ 동시 플레이어, 10000+ AI, 100000+ 오브젝트        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### SpatialOS 컴포넌트 정의

```
// Schema 정의 (.schema 파일)
package mygame;

component Position {
    id = 1001;
    float x = 1;
    float y = 2;
    float z = 3;
}

component Health {
    id = 1002;
    int32 current = 1;
    int32 max = 2;

    // 이벤트 정의
    event TakeDamage {
        int32 amount = 1;
        EntityId source = 2;
    }
}

component PlayerInput {
    id = 1003;
    float move_x = 1;
    float move_y = 2;
    bool jump = 3;
    bool attack = 4;
}
```

### Unity GDK 사용

```csharp
// Unity에서 SpatialOS 컴포넌트 핸들러
public class HealthBehaviour : MonoBehaviour
{
    [Require] private HealthWriter healthWriter;
    [Require] private HealthReader healthReader;

    private void OnEnable()
    {
        // 이벤트 구독
        healthReader.OnTakeDamageEvent += OnTakeDamage;
    }

    private void OnTakeDamage(TakeDamage damage)
    {
        var newHealth = healthReader.Data.Current - damage.Amount;

        // 상태 업데이트 (자동으로 다른 Worker에 전파)
        healthWriter.SendUpdate(new Health.Update
        {
            Current = Math.Max(0, newHealth)
        });

        if (newHealth <= 0)
        {
            HandleDeath();
        }
    }
}

// Worker 설정
public class GameLogicWorker : MonoBehaviour
{
    void Start()
    {
        // 이 Worker가 담당할 컴포넌트 타입 등록
        WorkerSystem.RegisterComponentType<Health>();
        WorkerSystem.RegisterComponentType<Combat>();
        WorkerSystem.RegisterComponentType<Inventory>();
    }
}
```

### Unreal GDK 사용

```cpp
// Unreal에서 SpatialOS Actor
UCLASS()
class AMyCharacter : public ACharacter
{
    GENERATED_BODY()

public:
    // SpatialOS 컴포넌트 매핑
    UPROPERTY(ReplicatedUsing = OnRep_Health)
    FHealthData Health;

    UFUNCTION()
    void OnRep_Health()
    {
        // 체력 변경 시 UI 업데이트
        UpdateHealthUI(Health.Current, Health.Max);
    }

    // Cross-Server RPC
    UFUNCTION(CrossServer, Reliable)
    void ServerTakeDamage(int32 Amount, AActor* Source);

    void ServerTakeDamage_Implementation(int32 Amount, AActor* Source)
    {
        Health.Current -= Amount;
        if (Health.Current <= 0)
        {
            Die();
        }
    }
};
```

---

## CAF (C++ Actor Framework)

```
📦 actor-framework/actor-framework
🌐 https://github.com/actor-framework/actor-framework
⭐ 3.1k+ stars
📝 C++17
📄 BSD-3 License
```

### 핵심 코드

```cpp
// CAF 기본 Actor
#include <caf/all.hpp>

using namespace caf;

// 메시지 타입 정의
struct player_join {
    std::string player_id;
    std::string name;
};
CAF_BEGIN_TYPE_ID_BLOCK(game_types, first_custom_type_id)
    CAF_ADD_TYPE_ID(game_types, (player_join))
CAF_END_TYPE_ID_BLOCK(game_types)

// 게임 룸 Actor
behavior game_room(stateful_actor<game_room_state>* self) {
    return {
        [=](player_join msg) {
            // 플레이어 추가
            self->state.players[msg.player_id] = msg.name;

            // 다른 플레이어들에게 알림
            for (auto& [id, player] : self->state.player_actors) {
                if (id != msg.player_id) {
                    self->send(player, player_joined_atom_v, msg.player_id, msg.name);
                }
            }

            return make_message(join_result_atom_v, true);
        },

        [=](position_update, std::string player_id, float x, float y, float z) {
            // 위치 업데이트 처리
            self->state.positions[player_id] = {x, y, z};

            // AOI 기반 브로드캐스트
            broadcast_to_nearby(self, player_id, x, y, z);
        },

        [=](tick_atom) {
            // 게임 루프 틱
            update_game_state(self);

            // 다음 틱 스케줄
            self->delayed_send(self, std::chrono::milliseconds(16), tick_atom_v);
        }
    };
}

// 플레이어 Actor
behavior player_actor(stateful_actor<player_state>* self,
                       std::string player_id,
                       actor game_room) {
    // 초기화
    self->state.player_id = player_id;
    self->state.room = game_room;

    return {
        [=](input_message, int key, bool pressed) {
            // 입력 처리
            process_input(self, key, pressed);
        },

        [=](player_joined_atom, std::string id, std::string name) {
            // 다른 플레이어 입장 처리
            self->state.nearby_players[id] = name;
        },

        [=](position_broadcast, std::string id, float x, float y, float z) {
            // 다른 플레이어 위치 수신
            update_remote_player_position(self, id, x, y, z);
        }
    };
}

// 메인 설정
void caf_main(actor_system& system) {
    // 설정
    auto cfg = system.config();

    // 게임 룸 생성
    auto room = system.spawn(game_room);

    // 분산 설정 (원격 통신)
    auto port = cfg.get_or("port", 12345);
    system.middleman().publish(room, port);
}
```

### CAF 클러스터링

```cpp
// 클러스터 노드 설정
class game_cluster : public caf::io::broker {
public:
    behavior make_behavior() override {
        return {
            [=](const caf::io::new_connection_msg& msg) {
                // 새 노드 연결
                auto worker = fork(node_worker, msg.handle);
                add_node(msg.handle, worker);
            },

            [=](shard_assign, std::string shard_id, actor target) {
                // 샤드 할당
                shards_[shard_id] = target;
            },

            [=](route_message, std::string shard_id, message msg) {
                // 메시지 라우팅
                if (auto it = shards_.find(shard_id); it != shards_.end()) {
                    send(it->second, std::move(msg));
                }
            }
        };
    }

private:
    std::unordered_map<std::string, actor> shards_;
};
```

---

## 프레임워크 비교

```
┌─────────────────────────────────────────────────────────────────┐
│                 게임 프레임워크 비교표                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  특성         Orbit    SpatialOS    CAF       Orleans           │
│  ──────       ─────    ─────────    ───       ───────           │
│  언어         Kotlin   Unity/UE4   C++       C#                 │
│  가상 Actor   O        △           X         O                  │
│  클러스터링   O        O           O         O                  │
│  성능         높음     높음        매우 높음  높음              │
│  학습 곡선    중간     높음        높음      낮음               │
│  게임 특화    O        O           △         O                  │
│  상용 사용    EA       AAA 스튜디오 다양     Xbox               │
│                                                                 │
│  적합한 사용 사례:                                               │
│  ────────────────                                                │
│  Orbit:     JVM 기반 온라인 게임 (EA 스타일)                    │
│  SpatialOS: 대규모 MMO, 1000+ 동접                              │
│  CAF:       고성능 필요, 네이티브 게임 서버                     │
│  Orleans:   .NET 게임, Xbox 플랫폼, 웹 게임                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 선택 가이드

```
┌─────────────────────────────────────────────────────────────────┐
│                    프레임워크 선택 기준                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Q: 어떤 프레임워크를 선택해야 할까?                            │
│                                                                 │
│  ┌─────────────────────────────────────┐                       │
│  │ 팀의 주 언어가 무엇인가?            │                       │
│  └──────────────┬──────────────────────┘                       │
│                 │                                               │
│    ┌────────────┼────────────┬────────────┐                    │
│    ▼            ▼            ▼            ▼                    │
│  C/C++       Java/Kotlin    C#         Go/Multi               │
│    │            │            │            │                    │
│    ▼            ▼            ▼            ▼                    │
│   CAF        Orbit       Orleans    Proto.Actor               │
│                                                                 │
│  ┌─────────────────────────────────────┐                       │
│  │ 규모가 어느 정도인가?               │                       │
│  └──────────────┬──────────────────────┘                       │
│                 │                                               │
│    ┌────────────┼────────────┐                                 │
│    ▼            ▼            ▼                                 │
│  소규모       중규모       대규모                              │
│  (<100)     (100-1000)    (1000+)                              │
│    │            │            │                                 │
│    ▼            ▼            ▼                                 │
│  아무거나    Orleans     SpatialOS                             │
│             Orbit       + 커스텀                               │
│                                                                 │
│  ┌─────────────────────────────────────┐                       │
│  │ Unity/Unreal을 사용하는가?          │                       │
│  └──────────────┬──────────────────────┘                       │
│                 │                                               │
│         Yes ────┴──── No                                        │
│          │            │                                         │
│          ▼            ▼                                         │
│      SpatialOS    Orleans/Orbit                                │
│      (GDK 지원)   Proto.Actor                                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 실전 아키텍처 예시

### MMO 게임 서버 (SpatialOS 스타일)

```
┌─────────────────────────────────────────────────────────────────┐
│                    MMO 아키텍처 예시                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│                     Load Balancer                               │
│                          │                                      │
│          ┌───────────────┼───────────────┐                     │
│          │               │               │                      │
│     ┌────▼────┐    ┌────▼────┐    ┌────▼────┐                 │
│     │Gateway 1│    │Gateway 2│    │Gateway 3│                 │
│     └────┬────┘    └────┬────┘    └────┬────┘                 │
│          │               │               │                      │
│          └───────────────┼───────────────┘                     │
│                          │                                      │
│              ┌───────────┴───────────┐                         │
│              │   Message Router      │                         │
│              │   (Proto.Actor/Akka)  │                         │
│              └───────────┬───────────┘                         │
│                          │                                      │
│     ┌────────────────────┼────────────────────┐                │
│     │                    │                    │                 │
│  ┌──▼──────────┐  ┌──────▼─────┐  ┌──────────▼──┐             │
│  │ Zone Shard 1│  │Zone Shard 2│  │Zone Shard 3 │             │
│  │ (Orleans)   │  │(Orleans)   │  │(Orleans)    │             │
│  │             │  │            │  │             │              │
│  │ [Player]    │  │[Player]    │  │[NPC]        │             │
│  │ [NPC]       │  │[Boss]      │  │[Environment]│             │
│  │ [Item]      │  │[Dungeon]   │  │[Weather]    │             │
│  └─────────────┘  └────────────┘  └─────────────┘             │
│                          │                                      │
│              ┌───────────┴───────────┐                         │
│              │   Persistence Layer   │                         │
│              │   (Event Sourcing)    │                         │
│              └───────────────────────┘                         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 참고 자료

- [Orbit GitHub](https://github.com/orbit/orbit)
- [SpatialOS Documentation](https://networking.docs.improbable.io/)
- [CAF - C++ Actor Framework](https://www.actor-framework.org/)
- [SpatialOS GDK for Unreal](https://github.com/spatialos/UnrealGDK)

---

## 다음 단계

- [orleans-repo.md](./orleans-repo.md) - Orleans 상세 분석
- [akka-repo.md](./akka-repo.md) - Akka 상세 분석
- [proto-actor-repo.md](./proto-actor-repo.md) - Proto.Actor 분석
