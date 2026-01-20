# Microsoft Orleans 소스코드 분석

> Orleans 프레임워크의 핵심 구조와 소스코드 분석 가이드입니다.

## 레포지토리 개요

```
📦 dotnet/orleans
🌐 https://github.com/dotnet/orleans
⭐ 10k+ stars
📝 C#
📄 MIT License
```

---

## 프로젝트 구조

```
orleans/
├── src/
│   ├── Orleans.Core/              # 핵심 인터페이스와 추상화
│   │   ├── Core/                  # Grain 기본 클래스
│   │   ├── Messaging/             # 메시지 시스템
│   │   └── Serialization/         # 직렬화
│   │
│   ├── Orleans.Runtime/           # 런타임 구현
│   │   ├── Catalog/               # Grain 활성화 관리
│   │   ├── Scheduler/             # 작업 스케줄러
│   │   ├── Messaging/             # 메시지 처리
│   │   └── GrainDirectory/        # Grain 위치 조회
│   │
│   ├── Orleans.Clustering.*/      # 클러스터링 구현체
│   ├── Orleans.Persistence.*/     # 영속화 구현체
│   └── Orleans.Streaming.*/       # 스트리밍 구현체
│
├── samples/                       # 예제 프로젝트
├── test/                          # 테스트 코드
└── playground/                    # 실험적 기능
```

---

## 핵심 개념 분석

### 1. Grain 클래스

```csharp
// 위치: src/Orleans.Core/Core/Grain.cs

/// <summary>
/// 모든 Grain의 기본 클래스
/// </summary>
public abstract class Grain : IGrainBase, IAddressable
{
    private IGrainContext _grainContext;

    /// <summary>
    /// 다른 Grain을 가져오는 팩토리
    /// </summary>
    protected IGrainFactory GrainFactory => _grainContext.GrainFactory;

    /// <summary>
    /// 타이머 등록
    /// </summary>
    protected IDisposable RegisterTimer(
        Func<object, Task> callback,
        object state,
        TimeSpan dueTime,
        TimeSpan period)
    {
        return _grainContext.RegisterTimer(callback, state, dueTime, period);
    }

    /// <summary>
    /// Grain 활성화 시 호출
    /// </summary>
    public virtual Task OnActivateAsync(CancellationToken token)
        => Task.CompletedTask;

    /// <summary>
    /// Grain 비활성화 시 호출
    /// </summary>
    public virtual Task OnDeactivateAsync(DeactivationReason reason, CancellationToken token)
        => Task.CompletedTask;
}
```

### 2. Grain 활성화 (Catalog)

```csharp
// 위치: src/Orleans.Runtime/Catalog/Catalog.cs

/// <summary>
/// Grain 활성화 관리자
/// 요청 시 Grain을 생성하고 관리
/// </summary>
internal class Catalog : ICatalog
{
    private readonly ConcurrentDictionary<GrainId, GrainContext> _activations;

    public async ValueTask<IGrainContext> GetGrain(GrainId grainId)
    {
        // 이미 활성화된 Grain이 있으면 반환
        if (_activations.TryGetValue(grainId, out var existing))
        {
            return existing;
        }

        // 없으면 새로 생성 (Virtual Actor 패턴)
        var newContext = await CreateGrainContext(grainId);

        if (_activations.TryAdd(grainId, newContext))
        {
            // 활성화 생명주기 시작
            await newContext.Activate();
            return newContext;
        }
        else
        {
            // 다른 스레드가 먼저 생성한 경우
            await newContext.DisposeAsync();
            return _activations[grainId];
        }
    }

    public async Task DeactivateGrain(GrainId grainId, DeactivationReason reason)
    {
        if (_activations.TryRemove(grainId, out var context))
        {
            await context.Deactivate(reason);
        }
    }
}
```

### 3. 메시지 시스템

```csharp
// 위치: src/Orleans.Runtime/Messaging/MessageCenter.cs

/// <summary>
/// 메시지 라우팅과 전달 담당
/// </summary>
internal class MessageCenter : IMessageCenter
{
    private readonly ILocalGrainDirectory _grainDirectory;

    public async Task SendMessage(Message message)
    {
        var targetGrain = message.TargetGrain;

        // 로컬 Grain인지 확인
        if (IsLocal(targetGrain))
        {
            // 로컬 배달
            await DeliverLocally(message);
        }
        else
        {
            // 원격 Silo 찾기
            var targetSilo = await _grainDirectory.Lookup(targetGrain);
            await SendToSilo(targetSilo, message);
        }
    }

    private async Task DeliverLocally(Message message)
    {
        var context = await _catalog.GetGrain(message.TargetGrain);

        // Grain의 작업 큐에 추가
        context.ReceiveMessage(message);
    }
}
```

### 4. 스케줄러

```csharp
// 위치: src/Orleans.Runtime/Scheduler/WorkItemGroup.cs

/// <summary>
/// Grain별 작업 큐 - 단일 스레드 실행 보장
/// </summary>
internal class WorkItemGroup : IWorkItemScheduler
{
    private readonly Queue<WorkItem> _workItems = new();
    private readonly object _lockObj = new();
    private bool _isExecuting;

    public void QueueWorkItem(WorkItem item)
    {
        lock (_lockObj)
        {
            _workItems.Enqueue(item);

            if (!_isExecuting)
            {
                _isExecuting = true;
                // 스레드풀에서 실행 예약
                ThreadPool.UnsafeQueueUserWorkItem(Execute, null);
            }
        }
    }

    private void Execute(object _)
    {
        while (true)
        {
            WorkItem item;
            lock (_lockObj)
            {
                if (_workItems.Count == 0)
                {
                    _isExecuting = false;
                    return;
                }
                item = _workItems.Dequeue();
            }

            // 작업 실행 (한 번에 하나만)
            item.Execute();
        }
    }
}
```

---

## 학습 포인트

### Virtual Actor 구현

```
Orleans의 Virtual Actor 핵심:
─────────────────────────────
1. 요청 시 자동 활성화
   - GetGrain() 호출 시 Catalog가 확인
   - 없으면 자동 생성

2. 위치 투명성
   - GrainDirectory가 위치 관리
   - 클라이언트는 위치 모름

3. 자동 비활성화
   - 유휴 시간 초과 시 비활성화
   - 메모리 자동 회수

4. 단일 활성화 보장
   - 클러스터 전체에서 하나만
   - Distributed Lock 사용
```

### 코드 리딩 순서

```
1단계: 인터페이스 이해
────────────────────
src/Orleans.Core/Core/IGrain.cs
src/Orleans.Core/Core/IGrainFactory.cs

2단계: Grain 생명주기
────────────────────
src/Orleans.Core/Core/Grain.cs
src/Orleans.Runtime/Catalog/Catalog.cs

3단계: 메시지 흐름
────────────────────
src/Orleans.Runtime/Messaging/Message.cs
src/Orleans.Runtime/Messaging/MessageCenter.cs

4단계: 클러스터링
────────────────────
src/Orleans.Runtime/MembershipService/
src/Orleans.Runtime/GrainDirectory/
```

---

## 주요 패턴

### Grain 상태 영속화

```csharp
// 위치: src/Orleans.Core/Core/GrainState.cs

public interface IPersistentState<TState> where TState : new()
{
    TState State { get; set; }
    string Etag { get; }
    bool RecordExists { get; }

    Task ReadStateAsync();
    Task WriteStateAsync();
    Task ClearStateAsync();
}

// 사용 예시
public class MyGrain : Grain
{
    private readonly IPersistentState<MyState> _state;

    public MyGrain(
        [PersistentState("state", "storage")]
        IPersistentState<MyState> state)
    {
        _state = state;
    }
}
```

### Observer 패턴

```csharp
// 클라이언트 → Grain 알림
public interface IGrainObserver : IGrain
{
    void ReceiveMessage(string message);
}

// Grain에서 Observer 관리
public class ChatGrain : Grain, IChatGrain
{
    private readonly HashSet<IGrainObserver> _observers = new();

    public Task Subscribe(IGrainObserver observer)
    {
        _observers.Add(observer);
        return Task.CompletedTask;
    }

    public async Task SendMessage(string message)
    {
        foreach (var observer in _observers)
        {
            observer.ReceiveMessage(message);  // one-way
        }
    }
}
```

---

## 확장 포인트

```csharp
// 커스텀 Grain 배치 전략
public class MyPlacementDirector : IPlacementDirector
{
    public Task<SiloAddress> OnAddActivation(
        PlacementStrategy strategy,
        PlacementTarget target,
        IPlacementContext context)
    {
        // 커스텀 배치 로직
    }
}

// 커스텀 직렬화
public class MySerializer : IGeneralizedCodec
{
    public object ReadValue<TInput>(ref Reader<TInput> reader, Field field);
    public void WriteField<TBufferWriter>(ref Writer<TBufferWriter> writer,
        uint fieldIdDelta, Type expectedType, object value);
}

// 커스텀 스토리지 프로바이더
public class MyStorageProvider : IGrainStorage
{
    public Task ReadStateAsync<T>(string stateName, GrainId grainId,
        IGrainState<T> grainState);
    public Task WriteStateAsync<T>(string stateName, GrainId grainId,
        IGrainState<T> grainState);
    public Task ClearStateAsync<T>(string stateName, GrainId grainId,
        IGrainState<T> grainState);
}
```

---

## 디버깅 팁

```csharp
// 로깅 활성화
siloBuilder.ConfigureLogging(logging =>
{
    logging.AddConsole();
    logging.SetMinimumLevel(LogLevel.Debug);
    logging.AddFilter("Orleans", LogLevel.Debug);
});

// 대시보드
siloBuilder.UseDashboard(options =>
{
    options.Port = 8080;
});
```

---

## 참고 자료

- [Orleans Documentation](https://learn.microsoft.com/dotnet/orleans/)
- [Orleans Design Patterns](https://learn.microsoft.com/dotnet/orleans/grains/grain-lifecycle)
- [Orleans GitHub Discussions](https://github.com/dotnet/orleans/discussions)

---

## 다음 단계

- [akka-repo.md](./akka-repo.md) - Akka 분석
- [proto-actor-repo.md](./proto-actor-repo.md) - Proto.Actor 분석
- [game-frameworks.md](./game-frameworks.md) - 게임 프레임워크 분석
