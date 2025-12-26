# Microsoft Orleans

> Virtual Actor 패턴의 선구자

## 개요

Orleans는 Microsoft Research에서 개발한 .NET 기반 Actor 프레임워크입니다. **Virtual Actor (Grain)** 패턴을 도입하여 Actor의 생명주기를 런타임이 자동으로 관리합니다.

```
┌─────────────────────────────────────────────────────────────────┐
│                    Orleans Architecture                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Client                                                         │
│     │                                                           │
│     ▼                                                           │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │                   Orleans Cluster                        │   │
│   │                                                          │   │
│   │   ┌─────────┐   ┌─────────┐   ┌─────────┐              │   │
│   │   │  Silo 1 │   │  Silo 2 │   │  Silo 3 │              │   │
│   │   │         │   │         │   │         │              │   │
│   │   │ [Grain] │   │ [Grain] │   │ [Grain] │              │   │
│   │   │ [Grain] │   │ [Grain] │   │ [Grain] │              │   │
│   │   └─────────┘   └─────────┘   └─────────┘              │   │
│   │                                                          │   │
│   │          Grain Directory (분산 해시 테이블)              │   │
│   │                                                          │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Virtual Actor (Grain)

### Classic Actor vs Virtual Actor

```
┌─────────────────────────────────────────────────────────────────┐
│           Classic Actor vs Virtual Actor (Grain)                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Classic Actor:                                                 │
│   • 명시적 생성 (Create)                                        │
│   • 명시적 종료 (Stop)                                          │
│   • 생명주기 직접 관리                                          │
│   • Actor가 없으면 메시지 실패                                  │
│                                                                  │
│   Virtual Actor (Grain):                                         │
│   • 필요 시 자동 활성화 (Activation)                            │
│   • 유휴 시 자동 비활성화 (Deactivation)                        │
│   • 생명주기 런타임이 관리                                      │
│   • Grain은 "항상 존재" (개념적으로)                            │
│                                                                  │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │  Grain "player-123"                                     │   │
│   │                                                          │   │
│   │  [비활성] ──요청──▶ [활성화] ──처리──▶ [활성]           │   │
│   │                                                          │   │
│   │  [활성] ──10분 유휴──▶ [비활성화] ──▶ [비활성]          │   │
│   │                                                          │   │
│   │  다음 요청 시 자동으로 다시 활성화                       │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 기본 사용법

### Grain 인터페이스 정의

```csharp
public interface IPlayerGrain : IGrainWithStringKey
{
    Task<PlayerState> GetState();
    Task SetName(string name);
    Task<int> AddScore(int points);
    Task JoinGame(Guid gameId);
}

public interface IGameGrain : IGrainWithGuidKey
{
    Task<bool> AddPlayer(string playerId);
    Task RemovePlayer(string playerId);
    Task<GameState> GetState();
}
```

### Grain 구현

```csharp
public class PlayerGrain : Grain, IPlayerGrain
{
    private readonly IPersistentState<PlayerState> _state;
    private readonly ILogger<PlayerGrain> _logger;

    public PlayerGrain(
        [PersistentState("player", "playerStore")]
        IPersistentState<PlayerState> state,
        ILogger<PlayerGrain> logger)
    {
        _state = state;
        _logger = logger;
    }

    public override async Task OnActivateAsync(CancellationToken ct)
    {
        _logger.LogInformation("Player {Id} activated", this.GetPrimaryKeyString());
        await base.OnActivateAsync(ct);
    }

    public override async Task OnDeactivateAsync(DeactivationReason reason, CancellationToken ct)
    {
        _logger.LogInformation("Player {Id} deactivating: {Reason}",
            this.GetPrimaryKeyString(), reason);
        await _state.WriteStateAsync();
        await base.OnDeactivateAsync(reason, ct);
    }

    public Task<PlayerState> GetState() => Task.FromResult(_state.State);

    public async Task SetName(string name)
    {
        _state.State.Name = name;
        await _state.WriteStateAsync();
    }

    public async Task<int> AddScore(int points)
    {
        _state.State.Score += points;
        await _state.WriteStateAsync();
        return _state.State.Score;
    }

    public async Task JoinGame(Guid gameId)
    {
        var game = GrainFactory.GetGrain<IGameGrain>(gameId);
        await game.AddPlayer(this.GetPrimaryKeyString());
        _state.State.CurrentGameId = gameId;
    }
}
```

### 클라이언트에서 사용

```csharp
// Grain 참조 획득 (생성 X, 논리적 참조)
var player = client.GetGrain<IPlayerGrain>("player-123");

// 메서드 호출 (필요 시 자동 활성화)
await player.SetName("Alice");
var score = await player.AddScore(100);
var state = await player.GetState();

// 다른 Grain과 상호작용
await player.JoinGame(Guid.NewGuid());
```

## 고급 기능

### 1. Grain Timers & Reminders

```csharp
public class HeartbeatGrain : Grain, IHeartbeatGrain
{
    private IDisposable? _timer;

    public override Task OnActivateAsync(CancellationToken ct)
    {
        // Timer: Grain 활성 동안만 동작
        _timer = RegisterTimer(
            callback: OnTick,
            state: null,
            dueTime: TimeSpan.Zero,
            period: TimeSpan.FromSeconds(10)
        );

        // Reminder: Grain 비활성화 후에도 지속
        RegisterOrUpdateReminder(
            reminderName: "daily-check",
            dueTime: TimeSpan.FromHours(24),
            period: TimeSpan.FromHours(24)
        );

        return base.OnActivateAsync(ct);
    }

    private Task OnTick(object state)
    {
        // 10초마다 실행
        return Task.CompletedTask;
    }

    public Task ReceiveReminder(string reminderName, TickStatus status)
    {
        // Reminder 처리 (Grain 재활성화됨)
        return Task.CompletedTask;
    }
}
```

### 2. Streams

```csharp
// Stream Provider 설정
public interface IChatGrain : IGrainWithStringKey
{
    Task SendMessage(string message);
    Task<StreamSubscriptionHandle<ChatMessage>> Subscribe();
}

public class ChatGrain : Grain, IChatGrain
{
    private IAsyncStream<ChatMessage>? _stream;

    public override Task OnActivateAsync(CancellationToken ct)
    {
        var streamProvider = this.GetStreamProvider("SMS");
        _stream = streamProvider.GetStream<ChatMessage>(
            StreamId.Create("chat", this.GetPrimaryKeyString())
        );
        return base.OnActivateAsync(ct);
    }

    public async Task SendMessage(string message)
    {
        await _stream!.OnNextAsync(new ChatMessage
        {
            Sender = this.GetPrimaryKeyString(),
            Content = message,
            Timestamp = DateTime.UtcNow
        });
    }
}
```

### 3. Grain 호출 필터

```csharp
public class LoggingFilter : IIncomingGrainCallFilter
{
    private readonly ILogger<LoggingFilter> _logger;

    public LoggingFilter(ILogger<LoggingFilter> logger)
    {
        _logger = logger;
    }

    public async Task Invoke(IIncomingGrainCallContext context)
    {
        var sw = Stopwatch.StartNew();
        try
        {
            await context.Invoke();
            _logger.LogInformation(
                "Grain {GrainType}.{Method} completed in {Elapsed}ms",
                context.Grain.GetType().Name,
                context.ImplementationMethod.Name,
                sw.ElapsedMilliseconds);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex,
                "Grain {GrainType}.{Method} failed",
                context.Grain.GetType().Name,
                context.ImplementationMethod.Name);
            throw;
        }
    }
}
```

## 클러스터 설정

```csharp
var builder = Host.CreateDefaultBuilder(args)
    .UseOrleans(siloBuilder =>
    {
        siloBuilder
            // 클러스터링 (Azure Table Storage 예시)
            .UseAzureStorageClustering(options =>
            {
                options.ConfigureTableServiceClient(connectionString);
            })
            // Grain 영속화
            .AddAzureTableGrainStorage("playerStore", options =>
            {
                options.ConfigureTableServiceClient(connectionString);
            })
            // 옵션
            .Configure<ClusterOptions>(options =>
            {
                options.ClusterId = "my-cluster";
                options.ServiceId = "my-service";
            })
            .Configure<SiloOptions>(options =>
            {
                options.SiloName = "Silo1";
            });
    });
```

## 장단점

### 장점

| 장점 | 설명 |
|------|------|
| 자동 생명주기 | 활성화/비활성화 자동 관리 |
| 위치 투명성 | Grain 위치 자동 관리 |
| .NET 통합 | C# 친숙한 문법 |
| 클라우드 친화적 | Azure 서비스 통합 |
| 무료 | MIT 라이센스 |

### 단점

| 단점 | 설명 |
|------|------|
| .NET 전용 | 다른 언어 미지원 |
| 재진입 주의 | 기본 재진입으로 인한 복잡성 |
| 단일 스레드 | Grain당 동시성 제한 |

## 사용 사례

```
┌─────────────────────────────────────────────────────────────────┐
│                   Orleans 사용 사례                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Xbox/Halo      - 게임 서버 백엔드                             │
│   Skype          - 메시징 서비스                                │
│   Azure PlayFab  - 게임 백엔드 서비스                           │
│   Plenty of Fish - 데이팅 앱                                    │
│   FreakOut       - 광고 기술                                    │
│   Endjin         - 분석 플랫폼                                  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 관련 문서

- [Virtual Actor 패턴](../11-patterns/README.md)
- [프레임워크 비교](./comparison-table.md)
- [게임 서버 사례](../10-use-cases/gaming.md)
