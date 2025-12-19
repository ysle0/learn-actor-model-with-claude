/**
 * Basic Actor Pattern - Counter Grain in C# with Orleans
 *
 * Orleans 프로젝트 생성:
 * dotnet new console -n CounterExample
 * cd CounterExample
 * dotnet add package Microsoft.Orleans.Server
 * dotnet add package Microsoft.Orleans.Client
 * dotnet add package Microsoft.Extensions.Hosting
 */

using Orleans;
using Orleans.Runtime;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.DependencyInjection;

// ============================================
// Grain Interface (Actor 인터페이스 정의)
// ============================================

public interface ICounterGrain : IGrainWithStringKey
{
    Task Increment();
    Task Decrement();
    Task<int> GetCount();
    Task Reset();
}

// ============================================
// Grain Implementation (Actor 구현)
// ============================================

public class CounterGrain : Grain, ICounterGrain
{
    // 캡슐화된 상태 - 외부에서 직접 접근 불가
    private int _count = 0;

    public Task Increment()
    {
        _count++;
        Console.WriteLine($"[{this.GetPrimaryKeyString()}] Incremented: {_count}");
        return Task.CompletedTask;
    }

    public Task Decrement()
    {
        _count--;
        Console.WriteLine($"[{this.GetPrimaryKeyString()}] Decremented: {_count}");
        return Task.CompletedTask;
    }

    public Task<int> GetCount()
    {
        return Task.FromResult(_count);
    }

    public Task Reset()
    {
        _count = 0;
        Console.WriteLine($"[{this.GetPrimaryKeyString()}] Reset to 0");
        return Task.CompletedTask;
    }

    // 생명주기 훅
    public override Task OnActivateAsync(CancellationToken ct)
    {
        Console.WriteLine($"[{this.GetPrimaryKeyString()}] Grain activated");
        return base.OnActivateAsync(ct);
    }

    public override Task OnDeactivateAsync(DeactivationReason reason, CancellationToken ct)
    {
        Console.WriteLine($"[{this.GetPrimaryKeyString()}] Grain deactivated: {reason}");
        return base.OnDeactivateAsync(reason, ct);
    }
}

// ============================================
// 영속성이 있는 Counter Grain
// ============================================

[Serializable]
public class CounterState
{
    public int Count { get; set; } = 0;
}

public interface IPersistentCounterGrain : IGrainWithStringKey
{
    Task Increment();
    Task<int> GetCount();
}

public class PersistentCounterGrain : Grain, IPersistentCounterGrain
{
    private readonly IPersistentState<CounterState> _state;

    public PersistentCounterGrain(
        [PersistentState("counter", "counterStore")]
        IPersistentState<CounterState> state)
    {
        _state = state;
    }

    public async Task Increment()
    {
        _state.State.Count++;
        await _state.WriteStateAsync();  // 상태 영속화
        Console.WriteLine($"[Persistent] Count: {_state.State.Count}");
    }

    public Task<int> GetCount()
    {
        return Task.FromResult(_state.State.Count);
    }
}

// ============================================
// Host 설정 및 실행
// ============================================

public class Program
{
    public static async Task Main(string[] args)
    {
        Console.WriteLine("=== Counter Grain Example (Orleans) ===\n");

        // Silo (서버) 시작
        var host = new HostBuilder()
            .UseOrleans(siloBuilder =>
            {
                siloBuilder
                    .UseLocalhostClustering()  // 로컬 개발용
                    .AddMemoryGrainStorage("counterStore");  // 메모리 저장소
            })
            .Build();

        await host.StartAsync();

        // Client 생성
        var client = host.Services.GetRequiredService<IClusterClient>();

        // Counter Grain 사용
        var counter = client.GetGrain<ICounterGrain>("counter-1");

        // Tell 패턴 (Orleans에서는 모든 호출이 async)
        await counter.Increment();
        await counter.Increment();
        await counter.Increment();
        await counter.Decrement();

        // Ask 패턴
        var count = await counter.GetCount();
        Console.WriteLine($"\nFinal count: {count}");

        // Reset
        await counter.Reset();
        count = await counter.GetCount();
        Console.WriteLine($"After reset: {count}");

        // 여러 Counter 사용 (각각 독립적인 Actor)
        Console.WriteLine("\n=== Multiple Counters ===\n");

        var counter2 = client.GetGrain<ICounterGrain>("counter-2");
        var counter3 = client.GetGrain<ICounterGrain>("counter-3");

        await Task.WhenAll(
            counter.Increment(),
            counter2.Increment(),
            counter2.Increment(),
            counter3.Increment(),
            counter3.Increment(),
            counter3.Increment()
        );

        var counts = await Task.WhenAll(
            counter.GetCount(),
            counter2.GetCount(),
            counter3.GetCount()
        );

        Console.WriteLine($"\ncounter-1: {counts[0]}");
        Console.WriteLine($"counter-2: {counts[1]}");
        Console.WriteLine($"counter-3: {counts[2]}");

        // 호스트 종료
        await host.StopAsync();
    }
}

// ============================================
// 동시성 데모
// ============================================

public static class ConcurrencyDemo
{
    public static async Task Run(IClusterClient client)
    {
        Console.WriteLine("\n=== Concurrency Demo ===\n");

        var counter = client.GetGrain<ICounterGrain>("concurrent-counter");
        await counter.Reset();

        // 1000개의 동시 요청
        var tasks = Enumerable.Range(0, 1000)
            .Select(_ => counter.Increment())
            .ToArray();

        await Task.WhenAll(tasks);

        var finalCount = await counter.GetCount();
        Console.WriteLine($"Expected: 1000, Actual: {finalCount}");
        Console.WriteLine($"Thread-safe: {(finalCount == 1000 ? "✅ YES" : "❌ NO")}");

        // Orleans Grain은 단일 스레드로 실행되므로 항상 1000
    }
}
