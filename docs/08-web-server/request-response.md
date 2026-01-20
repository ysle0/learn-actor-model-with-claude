# 요청-응답 패턴과 Actor

> 전통적인 HTTP 요청-응답 패턴을 Actor Model과 통합하는 방법을 다룹니다.

## 한 줄 요약

**HTTP 요청을 Actor 메시지로 변환하고, Ask 패턴으로 응답을 기다려 반환**

---

## HTTP와 Actor 매핑

```
┌─────────────────────────────────────────────────────────────────┐
│                   HTTP ↔ Actor 매핑                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   HTTP Request                      Actor Message               │
│   ────────────                      ─────────────               │
│   POST /users                  →    CreateUser(data)            │
│   GET  /users/{id}             →    GetUser(id)                 │
│   PUT  /users/{id}             →    UpdateUser(id, data)        │
│   DELETE /users/{id}           →    DeleteUser(id)              │
│                                                                 │
│   HTTP Response                     Actor Response              │
│   ─────────────                     ──────────────              │
│   200 OK + JSON                ←    Result<User>                │
│   201 Created                  ←    Created(id)                 │
│   404 Not Found                ←    NotFound                    │
│   500 Error                    ←    Exception                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Ask vs Tell 패턴

### Ask 패턴 (Request-Response)

```csharp
// HTTP 컨트롤러에서 Ask 패턴 사용
[ApiController]
[Route("api/users")]
public class UsersController : ControllerBase
{
    private readonly IClusterClient _orleans;

    public UsersController(IClusterClient orleans)
    {
        _orleans = orleans;
    }

    // GET /api/users/{id}
    [HttpGet("{id}")]
    public async Task<ActionResult<UserDto>> GetUser(string id)
    {
        var userGrain = _orleans.GetGrain<IUserGrain>(id);

        try
        {
            // Ask: 응답을 기다림
            var user = await userGrain.GetProfile();

            if (user == null)
                return NotFound();

            return Ok(user.ToDto());
        }
        catch (UserNotFoundException)
        {
            return NotFound();
        }
    }

    // POST /api/users
    [HttpPost]
    public async Task<ActionResult<UserDto>> CreateUser([FromBody] CreateUserRequest request)
    {
        var userId = Guid.NewGuid().ToString();
        var userGrain = _orleans.GetGrain<IUserGrain>(userId);

        // Ask: 생성 결과 기다림
        var result = await userGrain.Create(request.Name, request.Email);

        if (!result.Success)
            return BadRequest(result.Error);

        return CreatedAtAction(
            nameof(GetUser),
            new { id = userId },
            result.User.ToDto()
        );
    }
}
```

### Tell 패턴 (Fire-and-Forget)

```csharp
// 응답이 필요 없는 경우 Tell 패턴
[HttpPost("{id}/activity")]
public ActionResult LogActivity(string id, [FromBody] ActivityLog activity)
{
    var userGrain = _orleans.GetGrain<IUserGrain>(id);

    // Tell: 응답 기다리지 않음
    userGrain.LogActivity(activity);  // 반환값 무시

    return Accepted();  // 202 Accepted
}

// Grain 측
public class UserGrain : Grain, IUserGrain
{
    public Task LogActivity(ActivityLog activity)
    {
        // 비동기로 처리, 호출자는 기다리지 않음
        _activityLog.Add(activity);
        return Task.CompletedTask;
    }
}
```

---

## ASP.NET Core + Orleans 통합

### 설정

```csharp
// Program.cs
var builder = WebApplication.CreateBuilder(args);

// Orleans 클라이언트 추가
builder.Host.UseOrleansClient(clientBuilder =>
{
    clientBuilder.UseLocalhostClustering();
});

// 컨트롤러 추가
builder.Services.AddControllers();

var app = builder.Build();

app.MapControllers();
app.Run();
```

### 미들웨어 통합

```csharp
// Actor 기반 Rate Limiting
public class ActorRateLimitMiddleware
{
    private readonly RequestDelegate _next;
    private readonly IClusterClient _orleans;

    public ActorRateLimitMiddleware(RequestDelegate next, IClusterClient orleans)
    {
        _next = next;
        _orleans = orleans;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        var clientId = context.Connection.RemoteIpAddress?.ToString() ?? "unknown";
        var rateLimiter = _orleans.GetGrain<IRateLimiterGrain>(clientId);

        var allowed = await rateLimiter.TryAcquire();

        if (!allowed)
        {
            context.Response.StatusCode = 429;  // Too Many Requests
            await context.Response.WriteAsync("Rate limit exceeded");
            return;
        }

        await _next(context);
    }
}

// Rate Limiter Grain
public class RateLimiterGrain : Grain, IRateLimiterGrain
{
    private int _tokens;
    private DateTime _lastRefill;
    private const int MaxTokens = 100;
    private const int RefillRate = 10;  // per second

    public Task<bool> TryAcquire()
    {
        RefillTokens();

        if (_tokens > 0)
        {
            _tokens--;
            return Task.FromResult(true);
        }

        return Task.FromResult(false);
    }

    private void RefillTokens()
    {
        var now = DateTime.UtcNow;
        var elapsed = (now - _lastRefill).TotalSeconds;
        var tokensToAdd = (int)(elapsed * RefillRate);

        if (tokensToAdd > 0)
        {
            _tokens = Math.Min(MaxTokens, _tokens + tokensToAdd);
            _lastRefill = now;
        }
    }
}
```

---

## 타임아웃 처리

```csharp
// 타임아웃 설정
[HttpGet("{id}")]
public async Task<ActionResult<UserDto>> GetUser(string id)
{
    var userGrain = _orleans.GetGrain<IUserGrain>(id);

    try
    {
        // 타임아웃 설정
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5));

        var user = await userGrain.GetProfile()
            .WaitAsync(cts.Token);

        return Ok(user.ToDto());
    }
    catch (OperationCanceledException)
    {
        return StatusCode(504, "Gateway Timeout");  // 504
    }
    catch (TimeoutException)
    {
        return StatusCode(504, "Gateway Timeout");
    }
}

// Akka.NET에서 Ask with Timeout
public async Task<ActionResult> GetUserAkka(string id)
{
    try
    {
        var result = await _userActor.Ask<UserResponse>(
            new GetUser(id),
            timeout: TimeSpan.FromSeconds(5)
        );

        return Ok(result);
    }
    catch (AskTimeoutException)
    {
        return StatusCode(504);
    }
}
```

---

## 에러 처리 패턴

```csharp
// Result 패턴
public class Result<T>
{
    public bool Success { get; }
    public T Value { get; }
    public string Error { get; }
    public ErrorCode? Code { get; }

    public static Result<T> Ok(T value) => new(true, value, null, null);
    public static Result<T> Fail(string error, ErrorCode code) =>
        new(false, default, error, code);
}

// Grain에서 Result 반환
public class UserGrain : Grain, IUserGrain
{
    public async Task<Result<UserProfile>> GetProfile()
    {
        if (_state == null)
            return Result<UserProfile>.Fail("User not found", ErrorCode.NotFound);

        return Result<UserProfile>.Ok(_state.Profile);
    }

    public async Task<Result<bool>> UpdateEmail(string newEmail)
    {
        if (!IsValidEmail(newEmail))
            return Result<bool>.Fail("Invalid email format", ErrorCode.ValidationError);

        if (await IsEmailTaken(newEmail))
            return Result<bool>.Fail("Email already in use", ErrorCode.Conflict);

        _state.Email = newEmail;
        await _storage.WriteStateAsync();

        return Result<bool>.Ok(true);
    }
}

// 컨트롤러에서 Result 처리
[HttpPut("{id}/email")]
public async Task<ActionResult> UpdateEmail(string id, [FromBody] UpdateEmailRequest request)
{
    var userGrain = _orleans.GetGrain<IUserGrain>(id);
    var result = await userGrain.UpdateEmail(request.Email);

    if (!result.Success)
    {
        return result.Code switch
        {
            ErrorCode.NotFound => NotFound(result.Error),
            ErrorCode.ValidationError => BadRequest(result.Error),
            ErrorCode.Conflict => Conflict(result.Error),
            _ => StatusCode(500, result.Error)
        };
    }

    return Ok();
}
```

---

## 배치 요청 처리

```csharp
// 여러 Actor 병렬 호출
[HttpGet("bulk")]
public async Task<ActionResult<List<UserDto>>> GetUsers([FromQuery] string[] ids)
{
    // 병렬로 모든 Grain 호출
    var tasks = ids.Select(id =>
    {
        var grain = _orleans.GetGrain<IUserGrain>(id);
        return grain.GetProfile();
    });

    var users = await Task.WhenAll(tasks);

    return Ok(users
        .Where(u => u != null)
        .Select(u => u.ToDto())
        .ToList());
}

// 배치 작업 Grain
public interface IBatchGrain : IGrainWithIntegerKey
{
    Task<BatchResult> ProcessBatch(List<BatchItem> items);
}

public class BatchGrain : Grain, IBatchGrain
{
    public async Task<BatchResult> ProcessBatch(List<BatchItem> items)
    {
        var results = new List<ItemResult>();

        // 개별 Grain들에게 분배
        var tasks = items.Select(async item =>
        {
            var grain = GrainFactory.GetGrain<IItemGrain>(item.Id);
            try
            {
                await grain.Process(item.Data);
                return new ItemResult(item.Id, true, null);
            }
            catch (Exception ex)
            {
                return new ItemResult(item.Id, false, ex.Message);
            }
        });

        var itemResults = await Task.WhenAll(tasks);

        return new BatchResult
        {
            TotalItems = items.Count,
            SuccessCount = itemResults.Count(r => r.Success),
            FailedCount = itemResults.Count(r => !r.Success),
            Results = itemResults.ToList()
        };
    }
}
```

---

## 스트리밍 응답

```csharp
// Server-Sent Events (SSE) with Actor
[HttpGet("stream/{userId}")]
public async Task StreamEvents(string userId)
{
    Response.ContentType = "text/event-stream";

    var userGrain = _orleans.GetGrain<IUserGrain>(userId);

    // Stream observer 등록
    var observer = new SseObserver(Response);
    var observerRef = await _orleans.CreateObjectReference<IEventObserver>(observer);

    await userGrain.Subscribe(observerRef);

    try
    {
        // 연결 유지
        await Task.Delay(Timeout.InfiniteTimeSpan, HttpContext.RequestAborted);
    }
    finally
    {
        await userGrain.Unsubscribe(observerRef);
    }
}

public class SseObserver : IEventObserver
{
    private readonly HttpResponse _response;

    public SseObserver(HttpResponse response)
    {
        _response = response;
    }

    public async void OnEvent(GameEvent evt)
    {
        var data = JsonSerializer.Serialize(evt);
        await _response.WriteAsync($"data: {data}\n\n");
        await _response.Body.FlushAsync();
    }
}
```

---

## 성능 고려사항

```
┌─────────────────────────────────────────────────────────────────┐
│                   성능 고려사항                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  레이턴시 추가:                                                  │
│  ──────────────                                                 │
│  • 순수 HTTP: ~1-5ms                                            │
│  • HTTP + Local Actor: ~2-10ms                                  │
│  • HTTP + Remote Actor: ~5-20ms                                 │
│                                                                 │
│  최적화 방법:                                                    │
│  ────────────                                                   │
│  • 읽기는 캐시 사용                                              │
│  • 쓰기는 Tell (fire-and-forget) 고려                           │
│  • 배치 요청 활용                                                │
│  • Actor placement 최적화                                       │
│                                                                 │
│  권장 사용처:                                                    │
│  ────────────                                                   │
│  ✅ 사용자별 상태 조회/수정                                      │
│  ✅ 실시간 데이터가 필요한 API                                   │
│  ❌ 단순 CRUD (DB 직접 접근이 더 빠름)                          │
│  ❌ 대량 데이터 조회 (배치 서비스 권장)                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 다음 단계

- [session-management.md](./session-management.md) - Actor 기반 세션 관리
- [stateful-vs-stateless.md](./stateful-vs-stateless.md) - 아키텍처 선택
- [scaling-patterns.md](./scaling-patterns.md) - 스케일링 전략
