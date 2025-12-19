# 08. Web Server - 비실시간 서버 적합성 분석

> 전통적인 웹 서버와 REST API에서 Actor Model의 적합성을 분석합니다.

## 한 줄 요약

**일반적인 Stateless 웹 서버에는 과잉이지만, Stateful 서비스에서는 강력한 도구**

---

## 웹 서버에서 Actor Model이 필요한가?

```
┌─────────────────────────────────────────────────────────────────┐
│                    판단 기준                                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  일반적인 REST API (CRUD)                                       │
│  ─────────────────────────                                      │
│  • 요청 → DB 조회/수정 → 응답                                   │
│  • Stateless                                                    │
│  • 수평 확장 용이                                               │
│                                                                 │
│  → ❌ Actor Model 불필요 (오버엔지니어링)                       │
│  → ✅ 일반 웹 프레임워크 (Express, Spring, ASP.NET)              │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  Stateful 서비스가 필요한 경우                                   │
│  ────────────────────────────                                   │
│  • 실시간 협업 (Google Docs 류)                                 │
│  • 사용자별 상태 유지 (장바구니, 세션)                          │
│  • 실시간 알림/푸시                                             │
│  • 분산 캐시 대체                                               │
│                                                                 │
│  → ✅ Actor Model 고려                                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Stateless vs Stateful 비교

### 전통적 Stateless 아키텍처

```
┌─────────────────────────────────────────────────────────────────┐
│                 Stateless Web Server                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│    Client                                                       │
│      │                                                          │
│      ▼                                                          │
│  ┌───────────────┐                                             │
│  │ Load Balancer │                                             │
│  └───────┬───────┘                                             │
│          │                                                      │
│    ┌─────┼─────┐                                               │
│    ▼     ▼     ▼                                               │
│  ┌───┐ ┌───┐ ┌───┐                                            │
│  │ S │ │ S │ │ S │  ← 상태 없음, 어떤 서버로 가도 OK           │
│  └─┬─┘ └─┬─┘ └─┬─┘                                            │
│    │     │     │                                               │
│    └─────┼─────┘                                               │
│          ▼                                                      │
│    ┌───────────┐                                               │
│    │    DB     │  ← 상태는 DB에                                │
│    └───────────┘                                               │
│                                                                 │
│  장점: 단순, 확장 용이                                          │
│  단점: 매 요청마다 DB 조회                                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Actor 기반 Stateful 아키텍처

```
┌─────────────────────────────────────────────────────────────────┐
│                 Stateful with Actors                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│    Client                                                       │
│      │                                                          │
│      ▼                                                          │
│  ┌───────────────┐                                             │
│  │ Load Balancer │                                             │
│  └───────┬───────┘                                             │
│          │                                                      │
│    ┌─────┼─────┐                                               │
│    ▼     ▼     ▼                                               │
│  ┌─────────────────────────────────────┐                       │
│  │           Actor Cluster             │                       │
│  │  ┌────────┐ ┌────────┐ ┌────────┐  │                       │
│  │  │User001 │ │User002 │ │User003 │  │ ← 상태를 메모리에     │
│  │  │[state] │ │[state] │ │[state] │  │                       │
│  │  └────────┘ └────────┘ └────────┘  │                       │
│  └─────────────────┬───────────────────┘                       │
│                    │ (필요시만)                                 │
│                    ▼                                            │
│              ┌───────────┐                                     │
│              │    DB     │  ← 영속화 필요할 때만                │
│              └───────────┘                                     │
│                                                                 │
│  장점: 빠른 응답, 실시간 처리                                   │
│  단점: 복잡성 증가, 메모리 사용                                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Actor Model이 적합한 웹 서비스 유형

### 1. 실시간 협업 도구

```csharp
// 문서 협업 Actor (Orleans 예시)
public interface IDocumentGrain : IGrainWithStringKey
{
    Task ApplyEdit(string userId, Edit edit);
    Task<Document> GetDocument();
    Task Subscribe(IObserver observer);
}

public class DocumentGrain : Grain, IDocumentGrain
{
    private Document _document;
    private HashSet<IObserver> _subscribers = new();

    public async Task ApplyEdit(string userId, Edit edit)
    {
        // Operational Transform 적용
        _document = _document.Apply(edit);

        // 모든 구독자에게 실시간 전파
        foreach (var subscriber in _subscribers)
        {
            await subscriber.OnEdit(userId, edit);
        }
    }
}
```

### 2. 전자상거래 장바구니

```csharp
// 장바구니 Actor
public interface ICartGrain : IGrainWithStringKey
{
    Task AddItem(string productId, int quantity);
    Task RemoveItem(string productId);
    Task<Cart> GetCart();
    Task Checkout();
}

public class CartGrain : Grain, ICartGrain
{
    private Cart _cart = new();

    public Task AddItem(string productId, int quantity)
    {
        _cart.Items.Add(new CartItem(productId, quantity));
        return Task.CompletedTask;
    }

    // DB 조회 없이 메모리에서 즉시 응답
    public Task<Cart> GetCart() => Task.FromResult(_cart);
}
```

### 3. 실시간 알림 시스템

```csharp
// 사용자별 알림 Actor
public class NotificationActor : Grain, INotificationGrain
{
    private Queue<Notification> _pending = new();
    private IConnection _wsConnection;

    public async Task Notify(Notification notification)
    {
        if (_wsConnection != null && _wsConnection.IsOpen)
        {
            await _wsConnection.Send(notification);
        }
        else
        {
            _pending.Enqueue(notification);
        }
    }

    public async Task Connect(IConnection connection)
    {
        _wsConnection = connection;

        // 대기 중인 알림 전송
        while (_pending.TryDequeue(out var notification))
        {
            await connection.Send(notification);
        }
    }
}
```

---

## 성능 비교

```
┌─────────────────────────────────────────────────────────────────┐
│              읽기 작업 성능 비교 (예시)                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  시나리오: 사용자 프로필 조회                                    │
│                                                                 │
│  Stateless + DB                                                 │
│  ─────────────                                                  │
│  Request → Web Server → DB Query (~5ms) → Response             │
│  총 레이턴시: ~10-20ms                                          │
│                                                                 │
│  Stateless + Redis Cache                                        │
│  ─────────────────────                                          │
│  Request → Web Server → Redis (~1ms) → Response                │
│  총 레이턴시: ~5-10ms                                           │
│                                                                 │
│  Actor (Orleans/Akka)                                           │
│  ───────────────────                                            │
│  Request → Actor (in-memory, ~0.1ms) → Response                │
│  총 레이턴시: ~1-5ms                                            │
│                                                                 │
│  ※ Actor의 경우 첫 요청 시 활성화 비용 발생                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 웹 서버 통합 패턴

### ASP.NET + Orleans

```csharp
// Controller에서 Grain 호출
[ApiController]
[Route("api/[controller]")]
public class UsersController : ControllerBase
{
    private readonly IClusterClient _orleans;

    public UsersController(IClusterClient orleans)
    {
        _orleans = orleans;
    }

    [HttpGet("{id}")]
    public async Task<ActionResult<UserProfile>> GetUser(string id)
    {
        var userGrain = _orleans.GetGrain<IUserGrain>(id);
        return await userGrain.GetProfile();
    }

    [HttpPost("{id}/notify")]
    public async Task<ActionResult> Notify(string id, [FromBody] Notification notif)
    {
        var userGrain = _orleans.GetGrain<IUserGrain>(id);
        await userGrain.Notify(notif);
        return Ok();
    }
}
```

### Express + Proto.Actor (개념)

```typescript
// Express 라우터에서 Actor 호출
import { PID, ActorSystem } from 'protoactor';

const system = new ActorSystem();

app.get('/users/:id', async (req, res) => {
    const userActor = system.getActor(`user-${req.params.id}`);
    const profile = await userActor.request({ type: 'GET_PROFILE' });
    res.json(profile);
});

app.post('/users/:id/message', async (req, res) => {
    const userActor = system.getActor(`user-${req.params.id}`);
    userActor.tell({ type: 'NEW_MESSAGE', data: req.body });
    res.status(202).send();
});
```

---

## 언제 Actor Model을 선택하지 않을까?

```
┌─────────────────────────────────────────────────────────────────┐
│               Actor Model이 과잉인 경우                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ❌ 단순 CRUD API                                               │
│     • DB 읽기/쓰기만 수행                                       │
│     • 상태 유지 불필요                                          │
│     → 일반 웹 프레임워크 충분                                   │
│                                                                 │
│  ❌ 배치 처리 시스템                                            │
│     • 대량 데이터 처리                                          │
│     • 실시간성 불필요                                           │
│     → MapReduce, Spark 등                                       │
│                                                                 │
│  ❌ 트랜잭션 중심 시스템                                        │
│     • 강한 일관성 필요                                          │
│     • 복잡한 트랜잭션                                           │
│     → RDBMS + 전통적 아키텍처                                   │
│                                                                 │
│  ❌ 소규모 서비스                                               │
│     • 동시 사용자 수백 명                                       │
│     • 단순한 비즈니스 로직                                      │
│     → 단순함이 최고                                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 결정 체크리스트

```
□ 사용자별 상태를 서버에서 유지해야 하는가?
□ 실시간 업데이트가 필요한가? (WebSocket, SSE)
□ 동시 접속자가 수천 명 이상인가?
□ 분산 캐시로 해결하기 어려운 복잡한 상태가 있는가?
□ 이벤트 드리븐 아키텍처가 자연스러운가?

3개 이상 "예" → Actor Model 고려
그 외 → 일반 웹 아키텍처로 충분
```

---

## 심화 문서

| 주제 | 설명 | 링크 |
|------|------|------|
| 요청-응답 패턴 | Actor와 HTTP 매핑 | [request-response.md](./request-response.md) |
| 세션 관리 | Actor 기반 세션 | [session-management.md](./session-management.md) |
| 스케일링 | 수평 확장 전략 | [scaling-patterns.md](./scaling-patterns.md) |

---

## 다음 단계

- [09. Open Source](../09-open-source/README.md) - 오픈소스 분석
- [06. Game Server](../06-game-server/README.md) - 게임 서버 비교
