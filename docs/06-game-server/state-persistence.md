# 게임 상태 영속화 전략

> Actor 기반 게임 서버에서 상태를 안전하게 저장하고 복원하는 전략을 다룹니다.

## 한 줄 요약

**게임 특성에 맞는 영속화 전략(스냅샷, 이벤트 소싱, Write-Behind)을 선택하여 성능과 안정성 균형**

---

## 영속화가 필요한 이유

```
┌─────────────────────────────────────────────────────────────────┐
│                    영속화가 필요한 상황                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. 서버 재시작/장애 복구                                        │
│     ─────────────────────                                       │
│     • 서버 업데이트 후 상태 복원                                 │
│     • 크래시 후 데이터 손실 방지                                 │
│                                                                 │
│  2. Actor 비활성화 대응                                          │
│     ─────────────────────                                       │
│     • Orleans: 유휴 Grain 자동 비활성화                          │
│     • 재활성화 시 상태 복원 필요                                 │
│                                                                 │
│  3. 분산 환경 지원                                               │
│     ────────────────                                            │
│     • Actor가 다른 노드로 이동할 수 있음                         │
│     • 어떤 노드에서든 상태 접근 가능해야 함                      │
│                                                                 │
│  4. 규정 준수 및 감사                                            │
│     ─────────────────                                           │
│     • 게임 로그, 거래 기록                                       │
│     • 분쟁 해결을 위한 히스토리                                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 영속화 전략 비교

```
┌─────────────────────────────────────────────────────────────────┐
│                    영속화 전략 비교표                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  전략              장점                    단점                  │
│  ────────────────────────────────────────────────────────────   │
│  스냅샷 저장       • 단순한 구현           • 자주 저장 시 부하    │
│  (State Store)    • 복원 빠름             • 중간 상태 손실       │
│                                                                 │
│  이벤트 소싱       • 완전한 히스토리       • 복원 시간 길어짐     │
│  (Event Sourcing) • 감사 추적 가능        • 저장 공간 증가       │
│                   • 시간 여행 가능                               │
│                                                                 │
│  Write-Behind     • 쓰기 성능 최적화      • 데이터 손실 위험     │
│  (지연 쓰기)      • DB 부하 감소          • 복잡한 구현          │
│                                                                 │
│  하이브리드       • 균형 잡힌 접근        • 가장 복잡            │
│  (스냅샷+이벤트)  • 유연한 복구                                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 1. 스냅샷 저장 (State Store)

### 개념

```
┌─────────────────────────────────────────────────────────────────┐
│                    스냅샷 저장 패턴                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   Actor 상태                        Storage                     │
│   ─────────                         ───────                     │
│                                                                 │
│   ┌─────────────┐     WriteState    ┌─────────────┐            │
│   │  메모리     │ ─────────────────▶│    DB       │            │
│   │  State      │                   │  (전체 상태) │            │
│   └─────────────┘ ◀───────────────  └─────────────┘            │
│                       ReadState                                 │
│                                                                 │
│   저장 시점:                                                     │
│   ──────────                                                    │
│   • 중요 이벤트 발생 시                                          │
│   • 주기적 (타이머)                                              │
│   • Actor 비활성화 시                                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Orleans 구현

```csharp
// Grain 상태 정의
[Serializable]
public class PlayerState
{
    public string PlayerId { get; set; }
    public int Level { get; set; }
    public long Experience { get; set; }
    public int Currency { get; set; }
    public List<InventoryItem> Inventory { get; set; }
    public DateTime LastSaved { get; set; }
}

// Persistent State 사용
public class PlayerGrain : Grain, IPlayerGrain
{
    private readonly IPersistentState<PlayerState> _state;

    public PlayerGrain(
        [PersistentState("player", "PlayerStore")]
        IPersistentState<PlayerState> state)
    {
        _state = state;
    }

    // 상태 변경 후 저장
    public async Task AddExperience(int amount)
    {
        _state.State.Experience += amount;

        // 레벨업 체크
        while (_state.State.Experience >= GetRequiredExp(_state.State.Level))
        {
            _state.State.Experience -= GetRequiredExp(_state.State.Level);
            _state.State.Level++;
        }

        // 저장
        await _state.WriteStateAsync();
    }

    // 비활성화 시 자동 저장
    public override async Task OnDeactivateAsync(
        DeactivationReason reason,
        CancellationToken token)
    {
        _state.State.LastSaved = DateTime.UtcNow;
        await _state.WriteStateAsync();
        await base.OnDeactivateAsync(reason, token);
    }
}

// Storage Provider 설정 (Silo 구성)
siloBuilder.AddAzureTableGrainStorage(
    name: "PlayerStore",
    configureOptions: options =>
    {
        options.ConnectionString = connectionString;
        options.UseJson = true;  // JSON 직렬화
    });

// 또는 ADO.NET (SQL)
siloBuilder.AddAdoNetGrainStorage(
    name: "PlayerStore",
    configureOptions: options =>
    {
        options.ConnectionString = sqlConnectionString;
        options.Invariant = "System.Data.SqlClient";
    });
```

### 최적화: 조건부 저장

```csharp
public class OptimizedPlayerGrain : Grain, IPlayerGrain
{
    private readonly IPersistentState<PlayerState> _state;
    private bool _isDirty = false;
    private IDisposable _saveTimer;

    public override Task OnActivateAsync(CancellationToken token)
    {
        // 30초마다 변경사항 저장
        _saveTimer = RegisterTimer(
            SaveIfDirty,
            null,
            TimeSpan.FromSeconds(30),
            TimeSpan.FromSeconds(30)
        );
        return base.OnActivateAsync(token);
    }

    public Task AddExperience(int amount)
    {
        _state.State.Experience += amount;
        _isDirty = true;  // 변경 표시만
        return Task.CompletedTask;
    }

    private async Task SaveIfDirty(object _)
    {
        if (_isDirty)
        {
            await _state.WriteStateAsync();
            _isDirty = false;
        }
    }

    // 중요한 변경은 즉시 저장
    public async Task PurchaseItem(string itemId, int price)
    {
        _state.State.Currency -= price;
        _state.State.Inventory.Add(new InventoryItem(itemId));

        // 재화 변경은 즉시 저장 (보안상)
        await _state.WriteStateAsync();
        _isDirty = false;
    }
}
```

---

## 2. 이벤트 소싱 (Event Sourcing)

### 개념

```
┌─────────────────────────────────────────────────────────────────┐
│                   이벤트 소싱 패턴                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   현재 상태는 이벤트들의 재생(Replay) 결과                       │
│                                                                 │
│   이벤트 스트림:                                                 │
│   ──────────────                                                │
│   [PlayerCreated] → [ExpGained(100)] → [LevelUp(2)] →          │
│   [ItemAcquired("sword")] → [ExpGained(50)] → ...              │
│                                                                 │
│   상태 복원:                                                     │
│   ──────────                                                    │
│   초기 상태 + 모든 이벤트 재생 = 현재 상태                       │
│                                                                 │
│   장점:                                                         │
│   ──────                                                        │
│   • 완전한 감사 추적 (언제, 무엇이, 왜 변경되었는지)             │
│   • 시간 여행 (특정 시점 상태 재현)                              │
│   • 버그 재현 용이                                               │
│   • 이벤트 기반 시스템과 자연스러운 통합                         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Akka Persistence 구현

```scala
// 이벤트 정의
sealed trait PlayerEvent
case class ExpGained(amount: Int) extends PlayerEvent
case class LeveledUp(newLevel: Int) extends PlayerEvent
case class ItemAcquired(itemId: String) extends PlayerEvent
case class CurrencyChanged(delta: Int) extends PlayerEvent

// 상태 정의
case class PlayerState(
  level: Int = 1,
  experience: Int = 0,
  currency: Int = 1000,
  inventory: List[String] = Nil
) {
  def applyEvent(event: PlayerEvent): PlayerState = event match {
    case ExpGained(amount) =>
      copy(experience = experience + amount)
    case LeveledUp(newLevel) =>
      copy(level = newLevel)
    case ItemAcquired(itemId) =>
      copy(inventory = itemId :: inventory)
    case CurrencyChanged(delta) =>
      copy(currency = currency + delta)
  }
}

// 커맨드 정의
sealed trait PlayerCommand
case class GainExp(amount: Int) extends PlayerCommand
case class AcquireItem(itemId: String, price: Int) extends PlayerCommand

// Persistent Actor
class PlayerActor(playerId: String) extends PersistentActor {
  override def persistenceId: String = s"player-$playerId"

  private var state = PlayerState()

  // 커맨드 처리
  override def receiveCommand: Receive = {
    case GainExp(amount) =>
      // 이벤트 생성 및 저장
      val events = calculateExpEvents(amount)
      persistAll(events) { event =>
        state = state.applyEvent(event)
        // 저장 완료 후 응답
        if (event == events.last) {
          sender() ! state
        }
      }

    case AcquireItem(itemId, price) =>
      if (state.currency >= price) {
        val events = List(
          CurrencyChanged(-price),
          ItemAcquired(itemId)
        )
        persistAll(events) { event =>
          state = state.applyEvent(event)
        }
        sender() ! AcquireSuccess
      } else {
        sender() ! NotEnoughCurrency
      }
  }

  // 복구 시 이벤트 재생
  override def receiveRecover: Receive = {
    case event: PlayerEvent =>
      state = state.applyEvent(event)
    case SnapshotOffer(_, snapshot: PlayerState) =>
      state = snapshot
    case RecoveryCompleted =>
      // 복구 완료
  }

  // 스냅샷 저장 (최적화)
  private def maybeSaveSnapshot(): Unit = {
    if (lastSequenceNr % 100 == 0) {  // 100개 이벤트마다
      saveSnapshot(state)
    }
  }

  private def calculateExpEvents(amount: Int): List[PlayerEvent] = {
    var events = List[PlayerEvent](ExpGained(amount))
    var exp = state.experience + amount
    var level = state.level

    while (exp >= getRequiredExp(level)) {
      exp -= getRequiredExp(level)
      level += 1
      events = events :+ LeveledUp(level)
    }

    events
  }
}
```

### 스냅샷과 결합

```
┌─────────────────────────────────────────────────────────────────┐
│              스냅샷 + 이벤트 소싱 하이브리드                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   복구 과정:                                                     │
│   ──────────                                                    │
│   1. 마지막 스냅샷 로드 (빠름)                                   │
│   2. 스냅샷 이후 이벤트만 재생 (짧음)                            │
│                                                                 │
│   Timeline:                                                     │
│   ─────────                                                     │
│   [E1][E2][E3]...[E100][Snapshot][E101][E102][E103]             │
│                          ↑                                      │
│                     복구 시작점                                  │
│                                                                 │
│   스냅샷 저장 전략:                                              │
│   ─────────────────                                             │
│   • N개 이벤트마다 (예: 100개)                                   │
│   • 일정 시간마다 (예: 1시간)                                    │
│   • 중요 이벤트 후 (레벨업, 큰 거래 등)                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Write-Behind (지연 쓰기)

### 개념

```
┌─────────────────────────────────────────────────────────────────┐
│                   Write-Behind 패턴                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   1. 메모리에 즉시 반영                                          │
│   2. 변경사항을 큐에 적재                                        │
│   3. 백그라운드에서 배치 저장                                    │
│                                                                 │
│   ┌─────────┐    즉시     ┌──────────┐                         │
│   │ Request │ ─────────▶ │  Memory  │                         │
│   └─────────┘            │  State   │                         │
│                          └────┬─────┘                         │
│                               │ 큐잉                           │
│                               ▼                                │
│                          ┌──────────┐                         │
│                          │  Write   │                         │
│                          │  Queue   │                         │
│                          └────┬─────┘                         │
│                               │ 배치 (비동기)                  │
│                               ▼                                │
│                          ┌──────────┐                         │
│                          │    DB    │                         │
│                          └──────────┘                         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 구현 예시

```csharp
public class WriteBehindPlayerGrain : Grain, IPlayerGrain
{
    private PlayerState _state;
    private readonly Queue<StateChange> _pendingWrites = new();
    private IDisposable _flushTimer;
    private readonly SemaphoreSlim _flushLock = new(1, 1);

    public override async Task OnActivateAsync(CancellationToken token)
    {
        // DB에서 초기 상태 로드
        _state = await LoadFromDatabase();

        // 5초마다 플러시
        _flushTimer = RegisterTimer(
            FlushWrites,
            null,
            TimeSpan.FromSeconds(5),
            TimeSpan.FromSeconds(5)
        );

        await base.OnActivateAsync(token);
    }

    public Task AddExperience(int amount)
    {
        // 1. 메모리 즉시 업데이트
        _state.Experience += amount;

        // 2. 변경 큐잉
        _pendingWrites.Enqueue(new ExpChange(amount));

        return Task.CompletedTask;
    }

    public Task<int> GetExperience()
    {
        // 메모리에서 즉시 반환 (DB 조회 없음)
        return Task.FromResult(_state.Experience);
    }

    private async Task FlushWrites(object _)
    {
        if (_pendingWrites.Count == 0)
            return;

        await _flushLock.WaitAsync();
        try
        {
            // 배치로 모아서 저장
            var changes = new List<StateChange>();
            while (_pendingWrites.TryDequeue(out var change))
            {
                changes.Add(change);
            }

            if (changes.Count > 0)
            {
                await SaveChangesToDatabase(changes);
            }
        }
        finally
        {
            _flushLock.Release();
        }
    }

    public override async Task OnDeactivateAsync(
        DeactivationReason reason,
        CancellationToken token)
    {
        // 비활성화 전 모든 변경사항 저장
        await FlushWrites(null);
        await base.OnDeactivateAsync(reason, token);
    }
}
```

### 데이터 손실 위험 완화

```csharp
// 중요도에 따른 분류
public enum PersistenceUrgency
{
    Low,       // 배치 저장 OK (경험치, 일반 아이템)
    Medium,    // 짧은 간격 저장 (퀘스트 진행)
    High,      // 즉시 저장 (재화, 과금 아이템)
    Critical   // 즉시 저장 + 확인 (실제 결제)
}

public async Task ProcessChange(StateChange change, PersistenceUrgency urgency)
{
    // 메모리 업데이트
    ApplyChange(change);

    switch (urgency)
    {
        case PersistenceUrgency.Low:
            _pendingWrites.Enqueue(change);
            break;

        case PersistenceUrgency.Medium:
            _pendingWrites.Enqueue(change);
            if (_pendingWrites.Count > 10)  // 10개 이상 쌓이면
                await FlushWrites(null);
            break;

        case PersistenceUrgency.High:
            await SaveImmediately(change);
            break;

        case PersistenceUrgency.Critical:
            await SaveWithConfirmation(change);
            break;
    }
}
```

---

## 4. 게임별 영속화 전략

### MMORPG

```
┌─────────────────────────────────────────────────────────────────┐
│                    MMORPG 영속화 전략                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  데이터 유형          저장 전략              저장 주기           │
│  ───────────────────────────────────────────────────────────    │
│  플레이어 위치        Write-Behind           5-10초             │
│  인벤토리            즉시 저장               변경 시            │
│  퀘스트 진행          Write-Behind           10-30초            │
│  장비 변경            즉시 저장               변경 시            │
│  스킬/레벨           즉시 저장               변경 시            │
│  채팅 로그           비동기 배치             분 단위            │
│  전투 로그           이벤트 소싱             실시간             │
│  거래 기록           즉시 + 이벤트 소싱      즉시               │
│                                                                 │
│  ⚠️ 주의: 복제(Dupe) 버그 방지를 위해                           │
│     아이템/재화는 항상 즉시 저장                                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 배틀로얄 / 세션 기반 게임

```
┌─────────────────────────────────────────────────────────────────┐
│               세션 기반 게임 영속화 전략                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  게임 중 (In-Game):                                              │
│  ─────────────────                                              │
│  • 메모리에서만 상태 관리                                        │
│  • 저장 안 함 (세션이 짧으므로)                                  │
│                                                                 │
│  게임 종료 시:                                                   │
│  ─────────────                                                  │
│  • 결과 계산                                                     │
│  • 통계 업데이트 (즉시 저장)                                     │
│  • 보상 지급 (즉시 저장)                                         │
│  • 리플레이 데이터 (이벤트 로그) 저장                            │
│                                                                 │
│  플레이어 프로필:                                                │
│  ────────────────                                               │
│  • 승/패/킬 통계 → 게임 종료 시 업데이트                         │
│  • 시즌 랭킹 → 게임 종료 시 업데이트                             │
│  • 인벤토리/재화 → 변경 시 즉시 저장                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 턴제 게임

```
┌─────────────────────────────────────────────────────────────────┐
│                 턴제 게임 영속화 전략                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  이벤트 소싱에 최적화된 장르                                     │
│                                                                 │
│  각 턴을 이벤트로 저장:                                          │
│  ─────────────────────                                          │
│  [GameStarted] →                                                │
│  [Turn1: PlayerA moved piece from A1 to B2] →                  │
│  [Turn2: PlayerB attacked with skill X] →                      │
│  [Turn3: PlayerA used item Y] →                                │
│  ...                                                            │
│  [GameEnded: Winner = PlayerA]                                  │
│                                                                 │
│  장점:                                                          │
│  ──────                                                         │
│  • 완벽한 리플레이                                               │
│  • 중단 후 재개 용이                                             │
│  • 분쟁 해결 증거                                                │
│  • 비동기 멀티플레이 지원                                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. 저장소 선택 가이드

```
┌─────────────────────────────────────────────────────────────────┐
│                    저장소 선택 가이드                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Redis / In-Memory DB                                           │
│  ─────────────────────                                          │
│  용도: 세션 데이터, 캐시, 일시적 상태                            │
│  장점: 매우 빠름, 간단한 API                                     │
│  단점: 영속성 한계, 비용 (메모리)                                │
│                                                                 │
│  RDBMS (PostgreSQL, MySQL)                                      │
│  ──────────────────────────                                     │
│  용도: 트랜잭션 중요 데이터 (재화, 아이템)                       │
│  장점: ACID, 복잡한 쿼리                                         │
│  단점: 스케일링 어려움, 스키마 변경 비용                         │
│                                                                 │
│  NoSQL (MongoDB, DynamoDB)                                      │
│  ──────────────────────────                                     │
│  용도: 유연한 게임 데이터, 문서형 상태                           │
│  장점: 스키마 유연성, 수평 확장                                  │
│  단점: 트랜잭션 제한, 일관성 모델                                │
│                                                                 │
│  Event Store (EventStoreDB, Kafka)                              │
│  ─────────────────────────────────                              │
│  용도: 이벤트 소싱, 감사 로그                                    │
│  장점: 이벤트 스트리밍, 재생 기능                                │
│  단점: 학습 곡선, 복잡성                                         │
│                                                                 │
│  Azure Table / Cosmos DB                                        │
│  ────────────────────────                                       │
│  용도: Orleans 기본 저장소, 대규모 분산                          │
│  장점: 관리형, 글로벌 분산                                       │
│  단점: 비용, 벤더 종속                                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 복합 저장소 패턴

```csharp
// 데이터 유형별 저장소 분리
public class HybridPersistenceProvider
{
    private readonly IRedisCache _redis;         // 세션, 캐시
    private readonly ICosmosDbClient _cosmos;    // 게임 상태
    private readonly ISqlDatabase _sql;          // 재화, 결제
    private readonly IEventStore _eventStore;   // 이벤트 로그

    public async Task SavePlayerState(PlayerState state)
    {
        // 병렬 저장
        await Task.WhenAll(
            _redis.SetAsync($"session:{state.PlayerId}", state.Session),
            _cosmos.UpsertAsync(state.GameData),
            SaveCriticalData(state)
        );
    }

    private async Task SaveCriticalData(PlayerState state)
    {
        // 트랜잭션으로 재화 저장
        using var transaction = await _sql.BeginTransactionAsync();
        try
        {
            await _sql.UpdateAsync("Currency", state.Currency);
            await _sql.UpdateAsync("PremiumItems", state.PremiumItems);
            await transaction.CommitAsync();

            // 이벤트 기록
            await _eventStore.AppendAsync(new CurrencyChanged(
                state.PlayerId,
                state.Currency
            ));
        }
        catch
        {
            await transaction.RollbackAsync();
            throw;
        }
    }
}
```

---

## 6. 장애 복구 전략

### Checkpointing

```csharp
public class CheckpointingGrain : Grain
{
    private GameState _state;
    private int _operationsSinceCheckpoint = 0;
    private const int CheckpointInterval = 50;

    public async Task ProcessAction(GameAction action)
    {
        ApplyAction(action);
        _operationsSinceCheckpoint++;

        if (_operationsSinceCheckpoint >= CheckpointInterval)
        {
            await CreateCheckpoint();
            _operationsSinceCheckpoint = 0;
        }
    }

    private async Task CreateCheckpoint()
    {
        var checkpoint = new Checkpoint
        {
            State = _state.Clone(),
            Timestamp = DateTime.UtcNow,
            SequenceNumber = _currentSequence
        };

        await _checkpointStore.SaveAsync(checkpoint);

        // 오래된 체크포인트 정리
        await _checkpointStore.DeleteOlderThan(
            DateTime.UtcNow.AddHours(-24)
        );
    }

    public override async Task OnActivateAsync(CancellationToken token)
    {
        // 최신 체크포인트에서 복구
        var checkpoint = await _checkpointStore.GetLatestAsync();
        if (checkpoint != null)
        {
            _state = checkpoint.State;
            // 체크포인트 이후 이벤트 재생
            var events = await _eventStore.GetAfter(checkpoint.SequenceNumber);
            foreach (var evt in events)
            {
                ApplyEvent(evt);
            }
        }
    }
}
```

### 분산 트랜잭션 (Saga)

```csharp
// 아이템 거래 Saga
public class ItemTradeSaga
{
    public async Task<TradeResult> Execute(
        string sellerId, string buyerId, string itemId, int price)
    {
        var steps = new List<SagaStep>();

        try
        {
            // 1. 판매자 인벤토리에서 아이템 제거
            var sellerGrain = GrainFactory.GetGrain<IPlayerGrain>(sellerId);
            await sellerGrain.RemoveFromInventory(itemId);
            steps.Add(new RemoveItemStep(sellerId, itemId));

            // 2. 구매자 재화 차감
            var buyerGrain = GrainFactory.GetGrain<IPlayerGrain>(buyerId);
            await buyerGrain.DeductCurrency(price);
            steps.Add(new DeductCurrencyStep(buyerId, price));

            // 3. 판매자 재화 추가
            await sellerGrain.AddCurrency(price);
            steps.Add(new AddCurrencyStep(sellerId, price));

            // 4. 구매자 인벤토리에 아이템 추가
            await buyerGrain.AddToInventory(itemId);
            steps.Add(new AddItemStep(buyerId, itemId));

            return TradeResult.Success;
        }
        catch (Exception ex)
        {
            // 보상 트랜잭션 실행 (역순)
            foreach (var step in steps.AsEnumerable().Reverse())
            {
                await step.Compensate();
            }

            return TradeResult.Failed(ex.Message);
        }
    }
}
```

---

## 성능 벤치마크 고려사항

```
┌─────────────────────────────────────────────────────────────────┐
│                    성능 지표 참고값                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  저장소          쓰기 레이턴시      읽기 레이턴시    처리량      │
│  ─────────────────────────────────────────────────────────────  │
│  Redis           < 1ms             < 1ms           100K+ ops/s  │
│  DynamoDB        5-10ms            5-10ms          무제한       │
│  Cosmos DB       5-10ms            < 5ms           무제한       │
│  PostgreSQL      2-5ms             1-2ms           10K ops/s    │
│  EventStoreDB    1-2ms             1-2ms           50K events/s │
│                                                                 │
│  ※ 실제 성능은 데이터 크기, 네트워크, 설정에 따라 다름          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 다음 단계

- [../07-realtime-game/README.md](../07-realtime-game/README.md) - 실시간 게임 적합성
- [../11-patterns/event-sourcing.md](../11-patterns/event-sourcing.md) - 이벤트 소싱 상세
- [../11-patterns/saga.md](../11-patterns/saga.md) - Saga 패턴 상세
