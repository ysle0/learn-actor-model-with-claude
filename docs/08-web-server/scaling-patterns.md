# 스케일링 패턴

> Actor 기반 웹 서비스의 수평/수직 확장 전략을 다룹니다.

## 한 줄 요약

**Actor 클러스터링으로 자동 분산, 핫스팟 방지와 Grain 배치 최적화가 핵심**

---

## Actor 클러스터 스케일링

```
┌─────────────────────────────────────────────────────────────────┐
│                 Actor 클러스터 스케일링                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  초기 상태 (2 노드):                                            │
│  ┌─────────────┐      ┌─────────────┐                          │
│  │   Node 1    │      │   Node 2    │                          │
│  │ ○○○○○○○○   │      │ ○○○○○○○○   │                          │
│  │ (1000 actors)│      │ (1000 actors)│                          │
│  └─────────────┘      └─────────────┘                          │
│                                                                 │
│  스케일 아웃 (노드 추가):                                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │   Node 1    │  │   Node 2    │  │   Node 3    │            │
│  │ ○○○○○○     │  │ ○○○○○○     │  │ ○○○○○○     │            │
│  │ (666 actors) │  │ (666 actors) │  │ (668 actors) │            │
│  └─────────────┘  └─────────────┘  └─────────────┘            │
│                                                                 │
│  자동 리밸런싱:                                                  │
│  • 새 노드에 새 Actor 배치                                      │
│  • 기존 Actor는 비활성화 시 이동                                │
│  • 또는 명시적 마이그레이션                                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Orleans 클러스터 설정

```csharp
// Silo 설정 (서버 노드)
var builder = Host.CreateDefaultBuilder(args)
    .UseOrleans((context, siloBuilder) =>
    {
        var config = context.Configuration;

        // 클러스터 설정
        siloBuilder.Configure<ClusterOptions>(options =>
        {
            options.ClusterId = "production-cluster";
            options.ServiceId = "my-service";
        });

        // Azure Table 기반 클러스터링
        siloBuilder.UseAzureStorageClustering(options =>
        {
            options.ConnectionString = config["Azure:Storage"];
        });

        // 또는 Kubernetes 기반
        siloBuilder.UseKubernetesHosting();

        // 자동 스케일링 설정
        siloBuilder.Configure<LoadSheddingOptions>(options =>
        {
            options.LoadSheddingEnabled = true;
            options.LoadSheddingLimit = 95;  // CPU 95% 이상 시 거부
        });
    });
```

### Kubernetes 자동 스케일링

```yaml
# Orleans Silo Deployment
apiVersion: apps/v1
kind: Deployment
metadata:
  name: orleans-silo
spec:
  replicas: 3
  selector:
    matchLabels:
      app: orleans-silo
  template:
    spec:
      containers:
      - name: silo
        image: my-orleans-app:latest
        resources:
          requests:
            memory: "512Mi"
            cpu: "500m"
          limits:
            memory: "2Gi"
            cpu: "2000m"
---
# Horizontal Pod Autoscaler
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: orleans-silo-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: orleans-silo
  minReplicas: 3
  maxReplicas: 20
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
```

---

## 핫스팟 방지

### 문제: 인기 Actor 집중

```
┌─────────────────────────────────────────────────────────────────┐
│                    핫스팟 문제                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  예: 인기 상품 Actor                                            │
│                                                                 │
│  ┌─────────────┐      ┌─────────────┐      ┌─────────────┐    │
│  │   Node 1    │      │   Node 2    │      │   Node 3    │    │
│  │             │      │             │      │    ★★★     │    │
│  │  요청 10%   │      │  요청 10%   │      │  요청 80%   │    │
│  │             │      │             │      │  (병목!)    │    │
│  └─────────────┘      └─────────────┘      └─────────────┘    │
│                                                                 │
│  ★ = 인기 상품 Actor                                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 해결책 1: 샤딩

```csharp
// 단일 Actor 대신 샤딩된 Actor들
public interface IProductShardGrain : IGrainWithStringKey
{
    Task<Product> GetProduct();
    Task DecrementStock(int amount);
}

// 호출 시 샤드 선택
public class ProductService
{
    private readonly IClusterClient _client;
    private const int ShardCount = 10;

    public async Task<Product> GetProduct(string productId)
    {
        // 샤드 선택 (라운드 로빈 또는 해시)
        var shardId = GetShardId(productId);
        var grainId = $"{productId}_{shardId}";

        var grain = _client.GetGrain<IProductShardGrain>(grainId);
        return await grain.GetProduct();
    }

    private int GetShardId(string productId)
    {
        // 요청마다 다른 샤드 사용 (읽기 분산)
        return Random.Shared.Next(ShardCount);

        // 또는 세션 기반
        // return sessionId.GetHashCode() % ShardCount;
    }
}
```

### 해결책 2: 읽기/쓰기 분리

```csharp
// 쓰기는 단일 Actor
public interface IProductWriteGrain : IGrainWithStringKey
{
    Task UpdateProduct(ProductUpdate update);
    Task DecrementStock(int amount);
}

// 읽기는 복제본
public interface IProductReadGrain : IGrainWithStringKey
{
    Task<Product> GetProduct();
    Task RefreshCache();
}

public class ProductReadGrain : Grain, IProductReadGrain
{
    private Product _cache;
    private IDisposable _refreshTimer;

    public override Task OnActivateAsync(CancellationToken token)
    {
        // 주기적 캐시 갱신
        _refreshTimer = RegisterTimer(
            _ => RefreshCache(),
            null,
            TimeSpan.FromSeconds(5),
            TimeSpan.FromSeconds(5)
        );
        return base.OnActivateAsync(token);
    }

    public Task<Product> GetProduct() => Task.FromResult(_cache);

    public async Task RefreshCache()
    {
        var writeGrain = GrainFactory.GetGrain<IProductWriteGrain>(
            this.GetPrimaryKeyString().Split('_')[0]
        );
        _cache = await writeGrain.GetProduct();
    }
}
```

---

## Grain 배치 전략

```csharp
// 커스텀 배치 전략
[AttributeUsage(AttributeTargets.Class)]
public class PreferLocalPlacementAttribute : PlacementAttribute
{
    public PreferLocalPlacementAttribute() : base(new PreferLocalPlacement()) { }
}

public class PreferLocalPlacement : PlacementStrategy { }

public class PreferLocalPlacementDirector : IPlacementDirector
{
    public Task<SiloAddress> OnAddActivation(
        PlacementStrategy strategy,
        PlacementTarget target,
        IPlacementContext context)
    {
        // 요청자와 같은 Silo 선호
        var localSilo = context.LocalSilo;

        if (context.GetCompatibleSilos(target).Contains(localSilo))
        {
            return Task.FromResult(localSilo);
        }

        // 아니면 랜덤
        return Task.FromResult(context.GetCompatibleSilos(target).First());
    }
}

// 사용
[PreferLocalPlacement]
public class LocalServiceGrain : Grain, ILocalServiceGrain
{
    // 호출자와 같은 노드에 배치됨
}
```

---

## 상태 파티셔닝

```
┌─────────────────────────────────────────────────────────────────┐
│                    상태 파티셔닝                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  사용자 ID 기반 파티셔닝:                                        │
│  ──────────────────────                                         │
│                                                                 │
│  User ID: 0-999        → Partition 0 (Node 1)                  │
│  User ID: 1000-1999    → Partition 1 (Node 2)                  │
│  User ID: 2000-2999    → Partition 2 (Node 3)                  │
│  ...                                                            │
│                                                                 │
│  장점:                                                          │
│  • 예측 가능한 배치                                             │
│  • 관련 Actor 코로케이션                                        │
│  • 노드별 독립적 스케일                                         │
│                                                                 │
│  지리적 파티셔닝:                                                │
│  ────────────────                                               │
│  Region: Asia      → Cluster A (Tokyo, Seoul)                  │
│  Region: Europe    → Cluster B (Frankfurt, London)             │
│  Region: Americas  → Cluster C (Virginia, Oregon)              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

```csharp
// 지역 기반 Grain 라우팅
public class RegionalGrainFactory
{
    private readonly Dictionary<string, IClusterClient> _regionalClients;

    public IUserGrain GetUserGrain(string userId, string userRegion)
    {
        var client = _regionalClients[userRegion];
        return client.GetGrain<IUserGrain>(userId);
    }
}
```

---

## 로드 밸런싱

```csharp
// API Gateway에서 로드 밸런싱
public class LoadBalancedOrleansClient
{
    private readonly IClusterClient[] _clients;
    private int _currentIndex;

    public async Task<T> CallGrain<T>(
        Func<IClusterClient, Task<T>> grainCall)
    {
        var maxRetries = _clients.Length;

        for (int i = 0; i < maxRetries; i++)
        {
            var client = GetNextClient();

            try
            {
                return await grainCall(client);
            }
            catch (SiloUnavailableException)
            {
                // 다음 클라이언트 시도
                continue;
            }
        }

        throw new ServiceUnavailableException();
    }

    private IClusterClient GetNextClient()
    {
        var index = Interlocked.Increment(ref _currentIndex) % _clients.Length;
        return _clients[index];
    }
}
```

---

## 모니터링 및 자동 스케일링

```csharp
// 메트릭 수집
public class ClusterMetricsCollector
{
    private readonly IManagementGrain _management;

    public async Task<ClusterMetrics> CollectMetrics()
    {
        var silos = await _management.GetHosts(true);

        var metrics = new ClusterMetrics
        {
            TotalSilos = silos.Count,
            TotalActivations = 0,
            AverageCpuUsage = 0
        };

        foreach (var silo in silos)
        {
            var stats = await _management.GetRuntimeStatistics(silo.Key);
            metrics.TotalActivations += stats.ActivationCount;
            metrics.AverageCpuUsage += stats.CpuUsage;
        }

        metrics.AverageCpuUsage /= silos.Count;

        return metrics;
    }
}

// 자동 스케일링 결정
public class AutoScaler
{
    public ScaleDecision Evaluate(ClusterMetrics metrics)
    {
        if (metrics.AverageCpuUsage > 80)
            return ScaleDecision.ScaleOut;

        if (metrics.AverageCpuUsage < 30 && metrics.TotalSilos > MinSilos)
            return ScaleDecision.ScaleIn;

        return ScaleDecision.NoChange;
    }
}
```

---

## 다음 단계

- [request-response.md](./request-response.md) - 요청-응답 패턴
- [session-management.md](./session-management.md) - 세션 관리
- [stateful-vs-stateless.md](./stateful-vs-stateless.md) - 아키텍처 선택
