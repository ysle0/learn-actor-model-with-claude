# 게임 서버 Actor Model 적용 사례

> 실제 상용 게임에서 Actor Model을 어떻게 활용하고 있는지 상세히 분석합니다.

## 한 줄 요약

**Halo, EVE Online 등 대규모 게임들이 Actor Model로 수백만 동시 접속자를 처리**

---

## 1. Halo 시리즈 (Microsoft Orleans)

### 배경

```
┌─────────────────────────────────────────────────────────────────┐
│                    Halo 4/5 프로젝트 배경                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  문제 상황 (Halo 3 시절):                                        │
│  ─────────────────────                                          │
│  • 전통적인 클라이언트-서버 아키텍처                              │
│  • 출시일 서버 과부하 문제                                       │
│  • 수동 스케일링의 한계                                          │
│                                                                 │
│  Halo 4 목표:                                                   │
│  ────────────                                                   │
│  • 출시일 100만+ 동시 접속자 처리                                │
│  • 자동 확장/축소                                                │
│  • 24/7 무중단 서비스                                            │
│  • 개발자 친화적 프로그래밍 모델                                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Orleans 선택 이유

343 Industries(Halo 개발사)는 Microsoft Research에서 개발 중이던 Orleans 프레임워크를 발견하고, 협력하여 프레임워크를 발전시켰습니다.

```
Orleans의 핵심 특징:
───────────────────
• Virtual Actor (Grain): 항상 존재하는 것처럼 동작
• 자동 활성화/비활성화: 메모리 효율적 관리
• 위치 투명성: 분산 환경에서 투명한 통신
• 단일 스레드 실행: 동시성 버그 원천 차단
```

### Halo 4 서비스 아키텍처

```
┌─────────────────────────────────────────────────────────────────┐
│                 Halo 4 Orleans 기반 서비스                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │  Presence   │  │ Statistics  │  │  Matchmaking│             │
│  │   Service   │  │   Service   │  │   Service   │             │
│  │             │  │             │  │             │             │
│  │ • 온라인    │  │ • 게임 결과 │  │ • 매치 생성 │             │
│  │ • 친구 상태 │  │ • 랭킹/통계 │  │ • 스킬 매칭 │             │
│  │ • 활동 피드 │  │ • 업적      │  │ • 대기열    │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │   Title     │  │   Game      │  │   Content   │             │
│  │   Storage   │  │   History   │  │   Service   │             │
│  │             │  │             │  │             │             │
│  │ • 세이브    │  │ • 리플레이  │  │ • DLC 관리  │             │
│  │ • 설정      │  │ • 분석 데이터│  │ • 에셋     │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Grain 설계 예시

```csharp
// 플레이어 Presence Grain
public interface IPlayerPresenceGrain : IGrainWithStringKey
{
    Task SetOnline(GameTitle title);
    Task SetOffline();
    Task<PlayerStatus> GetStatus();
    Task<List<string>> GetOnlineFriends();
}

public class PlayerPresenceGrain : Grain, IPlayerPresenceGrain
{
    private PlayerStatus _status;
    private List<string> _friendIds;

    public async Task SetOnline(GameTitle title)
    {
        _status = new PlayerStatus
        {
            IsOnline = true,
            CurrentGame = title,
            LastSeen = DateTime.UtcNow
        };

        // 친구들에게 알림 (비동기)
        foreach (var friendId in _friendIds)
        {
            var friend = GrainFactory.GetGrain<IPlayerPresenceGrain>(friendId);
            friend.NotifyFriendOnline(this.GetPrimaryKeyString());
        }
    }
}

// 통계 Grain
public interface IPlayerStatsGrain : IGrainWithStringKey
{
    Task RecordGameResult(GameResult result);
    Task<PlayerStats> GetStats();
    Task<int> GetRank();
}
```

### 성과

```
┌─────────────────────────────────────────────────────────────────┐
│                      Halo 4 성과                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  출시일 성능:                                                    │
│  ────────────                                                   │
│  • 100만+ 동시 접속자 (첫 날)                                    │
│  • 1주일 내 400만 유니크 사용자                                  │
│  • 3000만+ 시간의 총 플레이 시간                                 │
│                                                                 │
│  기술적 성과:                                                    │
│  ────────────                                                   │
│  • 90%+ CPU 사용률로 안정 운영                                   │
│  • 거의 선형적 확장성 달성                                       │
│  • 출시일 무중단 서비스                                          │
│                                                                 │
│  Halo 5 추가 성과:                                               │
│  ─────────────────                                               │
│  • 더 많은 서비스 Orleans 이관                                   │
│  • 프레임워크 안정성 검증                                        │
│  • 오픈소스 공개 (2015년)                                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. EVE Online (Stackless Python)

### 개요

```
┌─────────────────────────────────────────────────────────────────┐
│                    EVE Online 특징                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  독특한 아키텍처:                                                │
│  ────────────────                                               │
│  • 단일 샤드 (Single Shard): 전 세계 플레이어가 하나의 우주에   │
│  • 동시 접속자: 최대 65,000+ (피크 타임)                         │
│  • 세계 기록: 단일 샤드 최대 동시 접속                           │
│                                                                 │
│  기술 스택:                                                      │
│  ──────────                                                      │
│  • Stackless Python: 경량 마이크로스레딩                         │
│  • Tasklet: Actor와 유사한 실행 단위                             │
│  • Channel: 메시지 패싱 메커니즘                                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Stackless Python의 Actor 모델

```python
# Stackless Python의 Tasklet = Actor
import stackless

# 태양계 Actor
def solar_system_actor(system_id, channel):
    ships = {}  # 시스템 내 함선들

    while True:
        message = channel.receive()  # 블로킹 대기

        if message['type'] == 'ship_enter':
            ship = message['ship']
            ships[ship.id] = ship
            broadcast_to_nearby(ships, ship, 'appeared')

        elif message['type'] == 'ship_move':
            ship_id = message['ship_id']
            new_pos = message['position']
            ships[ship_id].position = new_pos
            broadcast_movement(ships, ship_id, new_pos)

        elif message['type'] == 'combat':
            process_combat(message)

# Channel = Mailbox
system_channel = stackless.channel()
tasklet = stackless.tasklet(solar_system_actor)('Jita', system_channel)

# 메시지 전송
system_channel.send({'type': 'ship_enter', 'ship': player_ship})
```

### Time Dilation (TiDi)

EVE Online의 혁신적인 해결책:

```
┌─────────────────────────────────────────────────────────────────┐
│                    Time Dilation 메커니즘                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  문제: 대규모 전투 시 서버 과부하                                │
│  ────────────────────────────────                                │
│  • 수천 명의 플레이어가 한 시스템에 집중                         │
│  • 초당 수십만 개의 이벤트 처리 필요                             │
│  • 서버 처리 한계 초과                                           │
│                                                                 │
│  해결책: 게임 내 시간 희석                                       │
│  ──────────────────────────                                      │
│                                                                 │
│    부하 10%   →  TiDi 100% (정상 속도)                          │
│    부하 50%   →  TiDi 50%  (2배 느림)                            │
│    부하 100%  →  TiDi 10%  (10배 느림)                           │
│                                                                 │
│  실제 1초 = 게임 내 0.1초 ~ 1초                                  │
│                                                                 │
│  효과:                                                           │
│  ──────                                                          │
│  • 서버가 모든 액션을 처리할 시간 확보                           │
│  • 게임플레이 공정성 유지 (누구도 빨라지지 않음)                  │
│  • 데이터 손실 없는 대규모 전투 지원                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 아키텍처 구성

```
┌─────────────────────────────────────────────────────────────────┐
│                    EVE Online 서버 구조                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│                    ┌─────────────────┐                          │
│                    │   Tranquility   │ ← 메인 클러스터 이름     │
│                    │    Cluster      │                          │
│                    └────────┬────────┘                          │
│                             │                                   │
│        ┌────────────────────┼────────────────────┐              │
│        │                    │                    │              │
│  ┌─────┴─────┐       ┌─────┴─────┐       ┌─────┴─────┐        │
│  │Proxy Blade│       │Proxy Blade│       │Proxy Blade│        │
│  │(접속 처리)│       │(접속 처리)│       │(접속 처리)│        │
│  └─────┬─────┘       └─────┬─────┘       └─────┬─────┘        │
│        │                    │                    │              │
│        └────────────────────┼────────────────────┘              │
│                             │                                   │
│        ┌────────────────────┼────────────────────┐              │
│        │                    │                    │              │
│  ┌─────┴─────┐       ┌─────┴─────┐       ┌─────┴─────┐        │
│  │ SOL Blade │       │ SOL Blade │       │ SOL Blade │        │
│  │ (태양계1) │       │ (태양계2) │       │ (태양계N) │        │
│  │           │       │           │       │           │        │
│  │ Tasklets: │       │ Tasklets: │       │ Tasklets: │        │
│  │ • Ships   │       │ • Ships   │       │ • Ships   │        │
│  │ • Stations│       │ • Stations│       │ • Stations│        │
│  │ • NPCs    │       │ • NPCs    │       │ • NPCs    │        │
│  └───────────┘       └───────────┘       └───────────┘        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### GIL 한계와 극복

```python
# 문제: Python GIL로 인한 단일 스레드 제약
# 해결: CarbonIO - GIL 외부에서 네트워크 처리

"""
CarbonIO 아키텍처:
─────────────────
┌─────────────────┐     ┌─────────────────┐
│  Python/GIL     │     │   CarbonIO      │
│                 │     │  (C++ 멀티스레드)│
│  Game Logic     │◀───▶│  Network I/O    │
│  (Stackless)    │     │  (Lock-Free)    │
└─────────────────┘     └─────────────────┘
"""

# 태양계별 프로세스 분리
# 각 SOL Blade가 독립적인 Python 프로세스
```

---

## 3. 기타 상용 사례

### Roblox

```
┌─────────────────────────────────────────────────────────────────┐
│                        Roblox                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  규모:                                                          │
│  ──────                                                         │
│  • 일일 활성 사용자: 7000만+ (2024)                              │
│  • 동시 플레이어: 수백만                                         │
│  • 수백만 개의 게임 호스팅                                       │
│                                                                 │
│  Actor 모델 활용:                                                │
│  ────────────────                                               │
│  • Luau (Lua 기반) 스크립팅에서 Actor 패턴 지원                  │
│  • Parallel Luau: Actor 기반 병렬 처리                          │
│  • 각 게임 서버가 독립적인 Actor처럼 동작                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Riot Games (League of Legends)

```
┌─────────────────────────────────────────────────────────────────┐
│                   Riot Games 백엔드                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  • 매치메이킹, 채팅 등 백엔드 서비스에 Actor 패턴 활용           │
│  • Akka/Akka.NET 기반 시스템 운영                               │
│  • 게임 자체는 전용 게임 서버 사용                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Supercell (Clash of Clans, Brawl Stars)

```
┌─────────────────────────────────────────────────────────────────┐
│                      Supercell                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  아키텍처:                                                       │
│  ──────────                                                     │
│  • 각 클랜/플레이어를 독립적 엔티티로 관리                       │
│  • 이벤트 기반 비동기 처리                                       │
│  • 수평 확장 가능한 설계                                         │
│                                                                 │
│  기술:                                                           │
│  ──────                                                          │
│  • Java/Kotlin 기반 커스텀 프레임워크                            │
│  • Actor 패턴 영향을 받은 메시지 기반 설계                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. 실패 사례에서 배우기

### Project Darkstar (Sun Microsystems)

```
┌─────────────────────────────────────────────────────────────────┐
│                 Project Darkstar - 실패 사례                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  목표:                                                          │
│  ──────                                                         │
│  • Sun이 개발한 MMO용 Actor 기반 프레임워크                      │
│  • Java 기반, 분산 Actor 시스템                                  │
│                                                                 │
│  문제점:                                                         │
│  ────────                                                        │
│  • 역확장성 (Negative Scalability)                              │
│    서버를 추가할수록 오히려 성능 저하                            │
│                                                                 │
│  • 과도한 분산 오버헤드                                          │
│    모든 Actor 간 통신이 네트워크를 통해                          │
│                                                                 │
│  • 부적절한 Actor 세분화                                         │
│    너무 작은 단위로 Actor 분할                                   │
│                                                                 │
│  교훈:                                                           │
│  ──────                                                          │
│  • Actor 세분화 수준이 중요                                      │
│  • 네트워크 오버헤드 고려 필수                                   │
│  • 로컬 최적화와 분산 처리의 균형                                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. 성공 요인 분석

```
┌─────────────────────────────────────────────────────────────────┐
│                    성공한 사례들의 공통점                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. 적절한 Actor 세분화                                          │
│     ──────────────────                                          │
│     ✅ Halo: 플레이어, 게임 세션 단위                            │
│     ✅ EVE: 태양계 단위                                          │
│     ❌ Darkstar: 과도하게 작은 단위                              │
│                                                                 │
│  2. 하이브리드 접근                                              │
│     ─────────────                                               │
│     • 실시간 물리: 전용 엔진 (Actor 아님)                        │
│     • 게임 로직/상태: Actor 모델                                 │
│     • 영속화: 비동기 배치 처리                                   │
│                                                                 │
│  3. 부하 관리 전략                                               │
│     ─────────────                                               │
│     • Halo: 자동 스케일링                                        │
│     • EVE: Time Dilation                                        │
│                                                                 │
│  4. 점진적 도입                                                  │
│     ───────────                                                 │
│     • 전체 시스템을 한번에 전환하지 않음                         │
│     • 적합한 서비스부터 시작                                     │
│     • 검증 후 확대                                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 6. 게임 장르별 적용 가이드

| 장르 | Actor 적합성 | 적용 영역 | 주의사항 |
|------|-------------|----------|---------|
| **MMO RPG** | ⭐⭐⭐⭐⭐ | Zone, 플레이어, 길드 | Zone 크기 조절 |
| **MOBA** | ⭐⭐⭐⭐ | 매치, 플레이어 세션 | 물리는 별도 |
| **배틀로얄** | ⭐⭐⭐⭐ | 로비, 매치메이킹 | 인게임은 전용 서버 |
| **FPS** | ⭐⭐⭐ | 로비, 랭킹, 채팅 | 게임플레이는 Tick 기반 |
| **캐주얼/소셜** | ⭐⭐⭐⭐⭐ | 전체 시스템 | 최적의 사용처 |
| **턴제 전략** | ⭐⭐⭐⭐⭐ | 전체 시스템 | 가장 적합 |

---

## 참고 자료

### Halo / Orleans
- [Building Halo 4 Using the Actor Model - InfoQ](https://www.infoq.com/news/2015/03/halo4-actor-model/)
- [Orleans: Technology Behind Xbox Halo - ODBMS](https://www.odbms.org/blog/2016/02/orleans-the-technology-behind-xbox-halo4-and-halo5-interview-with-phil-bernstein/)
- [About Halo Game's Backend - CleverHeap](https://cleverheap.com/posts/about-halo-backend/)

### EVE Online
- [EVE Online Architecture - High Scalability](https://highscalability.com/eve-online-architecture/)
- [Stackless Python in EVE - SlideShare](https://www.slideshare.net/Arbow/stackless-python-in-eve)
- [EVE Online MMO Powered by Python - Talk Python](https://talkpython.fm/episodes/show/52/eve-online-mmo-game-powered-by-python)

### 일반
- [The Actor Model in Game Development](https://vhlam.com/article/the-actor-model-in-game-development)
- [GameDev.net - Distributed Actor Model Discussion](https://www.gamedev.net/forums/topic/672410-distrubuted-actor-model-for-a-realtime-game-server/)

---

## 다음 단계

- [game-room-actor.md](./game-room-actor.md) - 게임룸 Actor 상세 설계
- [player-actor.md](./player-actor.md) - 플레이어 Actor 설계
- [state-persistence.md](./state-persistence.md) - 상태 영속화 전략
