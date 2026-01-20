# Proto.Actor 소스코드 분석

> Proto.Actor 프레임워크의 핵심 구조와 소스코드 분석 가이드입니다.

## 레포지토리 개요

```
📦 asynkron/protoactor-dotnet
🌐 https://github.com/asynkron/protoactor-dotnet
⭐ 1.7k+ stars
📝 C#
📄 Apache-2.0 License

📦 asynkron/protoactor-go
🌐 https://github.com/asynkron/protoactor-go
⭐ 5k+ stars
📝 Go
📄 Apache-2.0 License
```

---

## 설계 원칙

```
┌─────────────────────────────────────────────────────────────────┐
│                 Proto.Actor 설계 원칙                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. Minimalistic API                                            │
│     • 작고 사용하기 쉬운 API                                     │
│     • JVM 스타일의 무거운 설정 회피                              │
│                                                                 │
│  2. Pass data, not objects                                      │
│     • Protobuf를 통한 명시적 직렬화                              │
│     • 크로스 플랫폼 호환성 보장                                  │
│                                                                 │
│  3. Be fast                                                     │
│     • 성능을 위해 마법같은 API 트릭 거부                         │
│     • 최적화된 메시지 전달                                       │
│                                                                 │
│  4. Build on existing tech                                      │
│     • gRPC - 네트워크 전송                                       │
│     • Consul.IO - 클러스터링                                     │
│     • Protobuf - 직렬화                                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 프로젝트 구조 (C#)

```
protoactor-dotnet/
├── src/
│   ├── Proto.Actor/                    # 코어 Actor 시스템
│   │   ├── Actor.cs                    # Actor 베이스
│   │   ├── PID.cs                      # Process ID (ActorRef)
│   │   ├── Props.cs                    # Actor 생성 설정
│   │   ├── Context/                    # Actor 컨텍스트
│   │   │   ├── IContext.cs
│   │   │   └── ActorContext.cs
│   │   ├── Mailbox/                    # 메일박스
│   │   │   ├── IMailbox.cs
│   │   │   └── DefaultMailbox.cs
│   │   └── Supervision/                # 감독 전략
│   │       └── SupervisorStrategy.cs
│   │
│   ├── Proto.Remote/                   # 원격 통신
│   │   ├── GrpcNet/                    # gRPC 기반 통신
│   │   └── Serialization/              # 직렬화
│   │
│   ├── Proto.Cluster/                  # 클러스터링
│   │   ├── Cluster.cs                  # 클러스터 관리
│   │   ├── Gossip/                     # 가십 프로토콜
│   │   └── Identity/                   # ID 조회
│   │
│   └── Proto.Persistence/              # 영속성
│       └── Persistence.cs
│
├── benchmarks/                         # 벤치마크
└── examples/                           # 예제 코드
```

---

## 프로젝트 구조 (Go)

```
protoactor-go/
├── actor/
│   ├── actor.go                        # Actor 인터페이스
│   ├── pid.go                          # Process ID
│   ├── props.go                        # Props 설정
│   ├── context.go                      # Context 인터페이스
│   ├── actor_context.go                # ActorContext 구현
│   └── mailbox/
│       ├── mailbox.go                  # 메일박스 인터페이스
│       └── default_mailbox.go          # 기본 구현
│
├── remote/                             # 원격 통신
│   └── remote.go
│
├── cluster/                            # 클러스터링
│   ├── cluster.go
│   └── gossip/
│
└── persistence/                        # 영속성
```

---

## 핵심 개념 분석

### 1. Actor 인터페이스

```go
// Go 버전: actor/actor.go

// Actor는 메시지를 받는 가장 기본적인 인터페이스
type Actor interface {
    Receive(c Context)
}

// Context는 Actor가 시스템과 상호작용하는 인터페이스
type Context interface {
    // 메시지 정보
    Message() interface{}
    Sender() *PID
    Self() *PID

    // 자식 Actor 관리
    Spawn(props *Props) *PID
    SpawnNamed(props *Props, name string) (*PID, error)

    // 메시지 전송
    Send(pid *PID, message interface{})
    Request(pid *PID, message interface{}) (interface{}, error)

    // 행위 전환
    SetBehavior(behavior ActorFunc)
    PushBehavior(behavior ActorFunc)
    PopBehavior()
}

// 함수형 Actor
type ActorFunc func(c Context)

func (f ActorFunc) Receive(c Context) {
    f(c)
}

// 사용 예시
func helloActor(c actor.Context) {
    switch msg := c.Message().(type) {
    case *Hello:
        fmt.Printf("Hello, %s!\n", msg.Name)
    }
}
```

```csharp
// C# 버전: Proto.Actor/Actor.cs

public interface IActor
{
    Task ReceiveAsync(IContext context);
}

public interface IContext
{
    // 메시지 정보
    object? Message { get; }
    PID? Sender { get; }
    PID Self { get; }

    // 자식 Actor 관리
    PID Spawn(Props props);
    PID SpawnNamed(Props props, string name);

    // 메시지 전송
    void Send(PID target, object message);
    Task<T> RequestAsync<T>(PID target, object message);

    // 행위 전환
    void SetBehavior(Receive behavior);
    void PushBehavior(Receive behavior);
    void PopBehavior();
}

// 사용 예시
public class HelloActor : IActor
{
    public Task ReceiveAsync(IContext context)
    {
        switch (context.Message)
        {
            case Hello hello:
                Console.WriteLine($"Hello, {hello.Name}!");
                break;
        }
        return Task.CompletedTask;
    }
}
```

### 2. PID (Process ID)

```go
// Go 버전: actor/pid.go

// PID는 Actor를 참조하는 고유 식별자
type PID struct {
    Address string  // 노드 주소 (예: "127.0.0.1:8080")
    Id      string  // Actor ID (예: "user/123")
}

// 메시지 전송
func (pid *PID) Tell(message interface{}) {
    ref := pid.ref()
    ref.SendUserMessage(pid, message)
}

// 요청-응답
func (pid *PID) Request(message interface{}, sender *PID) {
    ref := pid.ref()
    env := &MessageEnvelope{
        Message: message,
        Sender:  sender,
    }
    ref.SendUserMessage(pid, env)
}

// ref()는 로컬 또는 원격 Process 반환
func (pid *PID) ref() Process {
    if pid.Address == localAddress {
        return processRegistry.Get(pid)
    }
    return remoteProcess
}
```

```csharp
// C# 버전: Proto.Actor/PID.cs

public partial class PID
{
    public string Address { get; }
    public string Id { get; }

    // 메시지 전송 (Tell)
    public void SendUserMessage(ActorSystem system, object message)
    {
        var process = system.ProcessRegistry.Get(this);
        process.SendUserMessage(this, message);
    }

    // 요청-응답 (Ask)
    public Task<T> RequestAsync<T>(ActorSystem system, object message)
    {
        var future = new FutureProcess(system);
        SendUserMessage(system, new MessageEnvelope(message, future.Pid));
        return future.Task.ContinueWith(t => (T)t.Result);
    }
}
```

### 3. Props (Actor 생성 설정)

```go
// Go 버전: actor/props.go

type Props struct {
    producer       Producer
    mailboxProducer MailboxProducer
    spawner        SpawnerFunc
    supervisor     SupervisorStrategy
    middleware     []ReceiveMiddleware
}

// 생성자 패턴
func PropsFromProducer(producer Producer) *Props {
    return &Props{
        producer:       producer,
        mailboxProducer: defaultMailboxProducer,
        spawner:        defaultSpawner,
        supervisor:     defaultSupervisor,
    }
}

// 함수형 Actor Props
func PropsFromFunc(fn ActorFunc) *Props {
    return PropsFromProducer(func() Actor {
        return fn
    })
}

// 설정 체이닝
func (p *Props) WithMailbox(producer MailboxProducer) *Props {
    p.mailboxProducer = producer
    return p
}

func (p *Props) WithSupervisor(supervisor SupervisorStrategy) *Props {
    p.supervisor = supervisor
    return p
}

// 사용 예시
props := actor.PropsFromFunc(myActor).
    WithMailbox(mailbox.Bounded(1000)).
    WithSupervisor(actor.NewOneForOneStrategy(10, time.Second, decider))
```

```csharp
// C# 버전: Proto.Actor/Props.cs

public sealed record Props
{
    public Func<IActor> Producer { get; init; }
    public Func<IMailbox> MailboxProducer { get; init; }
    public ISupervisorStrategy SupervisorStrategy { get; init; }

    public static Props FromProducer(Func<IActor> producer) =>
        new Props { Producer = producer };

    public static Props FromFunc(Receive receive) =>
        FromProducer(() => new FunctionActor(receive));

    // 설정 체이닝
    public Props WithMailbox(Func<IMailbox> mailboxProducer) =>
        this with { MailboxProducer = mailboxProducer };

    public Props WithSupervisor(ISupervisorStrategy supervisor) =>
        this with { SupervisorStrategy = supervisor };
}

// 사용 예시
var props = Props.FromFunc(ctx =>
{
    if (ctx.Message is Hello hello)
        Console.WriteLine($"Hello {hello.Name}");
    return Task.CompletedTask;
})
.WithMailbox(() => new DefaultMailbox())
.WithSupervisor(new OneForOneStrategy((pid, reason) => SupervisorDirective.Restart, 10));
```

### 4. Mailbox

```go
// Go 버전: actor/mailbox/mailbox.go

type Mailbox interface {
    PostUserMessage(message interface{})
    PostSystemMessage(message SystemMessage)
    RegisterHandlers(invoker MessageInvoker, dispatcher Dispatcher)
    Start()
}

// 기본 구현
type defaultMailbox struct {
    userMailbox     queue.Queue  // 사용자 메시지 큐
    systemMailbox   queue.Queue  // 시스템 메시지 큐
    invoker        MessageInvoker
    dispatcher     Dispatcher
    suspended      int32
    schedulerStatus int32
}

func (m *defaultMailbox) PostUserMessage(message interface{}) {
    m.userMailbox.Push(message)
    m.schedule()
}

func (m *defaultMailbox) processMessages() {
    // 시스템 메시지 우선 처리
    for m.systemMailbox.Length() > 0 {
        msg := m.systemMailbox.Pop()
        m.invoker.InvokeSystemMessage(msg)
    }

    // 사용자 메시지 처리 (batch)
    for i := 0; i < throughput; i++ {
        if msg := m.userMailbox.Pop(); msg != nil {
            m.invoker.InvokeUserMessage(msg)
        } else {
            break
        }
    }
}
```

### 5. Supervision (감독)

```go
// Go 버전: actor/supervision.go

type SupervisorStrategy interface {
    HandleFailure(supervisor Supervisor, child *PID,
                  rs *RestartStatistics, reason interface{},
                  message interface{})
}

type Directive int

const (
    ResumeDirective Directive = iota
    RestartDirective
    StopDirective
    EscalateDirective
)

// One-For-One 전략
type oneForOneStrategy struct {
    maxRetries      int
    withinDuration  time.Duration
    decider         Decider
}

func (s *oneForOneStrategy) HandleFailure(
    supervisor Supervisor, child *PID,
    rs *RestartStatistics, reason interface{},
    message interface{}) {

    directive := s.decider(reason)

    switch directive {
    case RestartDirective:
        if s.shouldRestart(rs) {
            supervisor.RestartChildren(child)
        } else {
            supervisor.StopChildren(child)
        }
    case StopDirective:
        supervisor.StopChildren(child)
    case EscalateDirective:
        supervisor.EscalateFailure(reason, message)
    }
}

// 사용 예시
decider := func(reason interface{}) actor.Directive {
    switch reason.(type) {
    case *TemporaryError:
        return actor.RestartDirective
    case *FatalError:
        return actor.StopDirective
    default:
        return actor.EscalateDirective
    }
}

supervisor := actor.NewOneForOneStrategy(10, time.Minute, decider)
```

---

## Cluster (Virtual Actor)

```csharp
// Proto.Cluster - Virtual Actor 패턴

// 1. Grain 인터페이스 정의 (Protobuf)
// grains.proto
syntax = "proto3";
package grains;

service HelloGrain {
    rpc SayHello(HelloRequest) returns (HelloResponse);
}

message HelloRequest {
    string name = 1;
}

message HelloResponse {
    string message = 1;
}

// 2. Grain 구현
public class HelloGrain : HelloGrainBase
{
    private readonly string _identity;

    public HelloGrain(IContext context, string identity)
        : base(context)
    {
        _identity = identity;
    }

    public override Task<HelloResponse> SayHello(HelloRequest request)
    {
        return Task.FromResult(new HelloResponse
        {
            Message = $"Hello {request.Name} from {_identity}!"
        });
    }
}

// 3. 클러스터 설정
var system = new ActorSystem()
    .WithRemote(GrpcNetRemoteConfig
        .BindToLocalhost()
        .WithProtoMessages(MessagesReflection.Descriptor))
    .WithCluster(ClusterConfig
        .Setup("MyCluster", new ConsulProvider(consulConfig))
        .WithClusterKind("hello", Props.FromProducer(() =>
            new HelloGrainActor((ctx, identity) => new HelloGrain(ctx, identity)))));

await system.Cluster().StartMemberAsync();

// 4. Grain 호출
var grain = system.Cluster().GetGrain<HelloGrainClient>("user-123", "hello");
var response = await grain.SayHello(new HelloRequest { Name = "World" });
```

```go
// Go 버전 Cluster

// Grain 정의
type HelloGrain struct {
    cluster.Grain
}

func (g *HelloGrain) ReceiveDefault(ctx cluster.GrainContext) {
    switch msg := ctx.Message().(type) {
    case *HelloRequest:
        ctx.Respond(&HelloResponse{
            Message: fmt.Sprintf("Hello %s!", msg.Name),
        })
    }
}

// 클러스터 시작
cluster, _ := cluster.New(
    cluster.Configure("MyCluster",
        remote.Configure("localhost", 0),
        cluster.WithProvider(consul.New()),
        cluster.WithKinds(
            cluster.NewKind("hello", actor.PropsFromProducer(func() actor.Actor {
                return &HelloGrain{}
            })),
        ),
    ),
)
cluster.Start()

// Grain 호출
grain := cluster.GetGrain("user-123", "hello")
resp, _ := grain.Request(&HelloRequest{Name: "World"})
```

---

## Gossip 프로토콜

```
┌─────────────────────────────────────────────────────────────────┐
│                    Gossip 기반 클러스터 멤버십                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Node A        Node B        Node C        Node D               │
│    │             │             │             │                  │
│    │──gossip────▶│             │             │                  │
│    │             │──gossip────▶│             │                  │
│    │             │             │──gossip────▶│                  │
│    │◀────────────────────────────────gossip──│                  │
│    │             │             │             │                  │
│                                                                 │
│  Gossip 내용:                                                   │
│  ─────────────                                                  │
│  • 멤버십 상태 (Alive, Suspect, Dead)                           │
│  • Grain 배치 정보                                              │
│  • 클러스터 토폴로지                                            │
│  • 사용자 정의 상태                                              │
│                                                                 │
│  수렴 특성:                                                     │
│  ──────────                                                     │
│  • 결과적 일관성 (Eventually Consistent)                        │
│  • O(log N) 전파 시간                                           │
│  • 네트워크 파티션 허용                                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

```csharp
// Gossip 상태 구독
system.Cluster().Gossip.Subscribe("my-state", state =>
{
    Console.WriteLine($"Cluster state updated: {state}");
});

// Gossip 상태 설정
system.Cluster().Gossip.Set("my-state", new MyClusterState
{
    ActiveUsers = 1000,
    LoadLevel = 0.75
});
```

---

## 성능 최적화

### 벤치마크 결과

```
┌─────────────────────────────────────────────────────────────────┐
│                 Proto.Actor 벤치마크                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  로컬 메시지 전송 (ping-pong):                                   │
│  ────────────────────────────                                   │
│  • Go 버전: ~15M msg/sec                                        │
│  • C# 버전: ~10M msg/sec                                        │
│                                                                 │
│  원격 메시지 전송 (gRPC):                                        │
│  ─────────────────────────                                       │
│  • ~500K msg/sec (직렬화 포함)                                   │
│                                                                 │
│  Actor 생성:                                                    │
│  ────────────                                                   │
│  • ~1M actors/sec                                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 최적화 팁

```go
// 1. Bounded Mailbox 사용
props := actor.PropsFromFunc(handler).
    WithMailbox(mailbox.Bounded(10000))

// 2. 메시지 풀링
var messagePool = sync.Pool{
    New: func() interface{} {
        return &MyMessage{}
    },
}

func getMsg() *MyMessage {
    return messagePool.Get().(*MyMessage)
}

func putMsg(m *MyMessage) {
    m.Reset()
    messagePool.Put(m)
}

// 3. 배치 처리
type BatchActor struct {
    batch    []*Event
    timer    *time.Timer
    maxBatch int
}

func (a *BatchActor) Receive(ctx actor.Context) {
    switch msg := ctx.Message().(type) {
    case *Event:
        a.batch = append(a.batch, msg)
        if len(a.batch) >= a.maxBatch {
            a.flush()
        }
    case *FlushSignal:
        a.flush()
    }
}
```

---

## Akka/Orleans와의 비교

```
┌─────────────────────────────────────────────────────────────────┐
│           Proto.Actor vs Akka vs Orleans                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  특성          Proto.Actor    Akka         Orleans              │
│  ────────────  ────────────   ────────────  ────────────        │
│  언어          Go/C#/Kotlin   Scala/Java   C#                   │
│  API 스타일    미니멀리스트   풍부한 API   Virtual Actor        │
│  직렬화        Protobuf       여러 옵션    Orleans 내장         │
│  네트워킹      gRPC           Artery       Orleans 내장         │
│  클러스터링    Consul/etc     Akka 내장    Azure/etc            │
│  학습 곡선     낮음           높음         중간                 │
│                                                                 │
│  장점:                                                          │
│  ─────                                                          │
│  Proto.Actor: 경량, 크로스플랫폼, gRPC/Protobuf 표준            │
│  Akka:        기능 풍부, 생태계 넓음, 검증됨                    │
│  Orleans:     Virtual Actor, .NET 통합, 자동 활성화             │
│                                                                 │
│  선택 기준:                                                     │
│  ──────────                                                     │
│  • 다중 언어 필요 → Proto.Actor                                 │
│  • JVM 환경/고급 기능 → Akka                                    │
│  • .NET + 게임/웹 → Orleans                                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 학습 포인트

```
Proto.Actor 핵심 학습:
────────────────────────
1. Actor = 메시지 핸들러
   • Receive(Context) 구현이 전부
   • 상태는 구조체 필드에 보관

2. PID = Actor 참조
   • Address + ID로 구성
   • 로컬/원격 투명하게 작동

3. Props = Actor 팩토리
   • 생성 방법, 메일박스, 감독 전략 설정
   • 불변, 체이닝 패턴

4. Cluster = Virtual Actor
   • 위치 투명성
   • 자동 활성화/비활성화

코드 리딩 순서:
────────────────
1단계: actor/actor.go (또는 Actor.cs)
2단계: actor/pid.go, props.go
3단계: actor/context.go, actor_context.go
4단계: cluster/cluster.go
```

---

## 실전 예제

### 채팅 서버

```go
// chat/room.go
type ChatRoom struct {
    members map[*actor.PID]string
}

func (r *ChatRoom) Receive(ctx actor.Context) {
    switch msg := ctx.Message().(type) {
    case *actor.Started:
        r.members = make(map[*actor.PID]string)

    case *JoinRoom:
        r.members[msg.User] = msg.Username
        r.broadcast(ctx, &UserJoined{Username: msg.Username})

    case *LeaveRoom:
        delete(r.members, msg.User)
        r.broadcast(ctx, &UserLeft{Username: msg.Username})

    case *SendMessage:
        r.broadcast(ctx, &ChatMessage{
            From:    r.members[ctx.Sender()],
            Content: msg.Content,
        })
    }
}

func (r *ChatRoom) broadcast(ctx actor.Context, msg interface{}) {
    for pid := range r.members {
        ctx.Send(pid, msg)
    }
}
```

---

## 참고 자료

- [Proto.Actor 공식 사이트](https://proto.actor/)
- [Proto.Actor .NET GitHub](https://github.com/asynkron/protoactor-dotnet)
- [Proto.Actor Go GitHub](https://github.com/asynkron/protoactor-go)
- [RealTimeMap 예제](https://github.com/asynkron/realtimemap-dotnet)

---

## 다음 단계

- [game-frameworks.md](./game-frameworks.md) - 게임 프레임워크 분석
- [akka-repo.md](./akka-repo.md) - Akka 분석
- [orleans-repo.md](./orleans-repo.md) - Orleans 분석
