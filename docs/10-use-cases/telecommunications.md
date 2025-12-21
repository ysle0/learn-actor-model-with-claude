# 통신 시스템에서의 Actor Model

> Erlang과 Actor Model의 탄생지, 통신 산업 케이스 스터디

## Ericsson과 Erlang의 탄생

### 배경

1980년대 Ericsson은 전화 교환기 시스템의 근본적인 문제에 직면했습니다:

```
기존 시스템의 문제점:
─────────────────────
• 단일 장애점 (Single Point of Failure)
• 업데이트 시 전체 시스템 중단 필요
• 동시 통화 처리의 한계
• 장애 복구 시간이 너무 김
```

### 요구사항

통신 시스템의 핵심 요구사항:

1. **고가용성**: 99.9999999% 업타임 (Nine Nines)
2. **동시성**: 수백만 동시 통화 처리
3. **실시간성**: 지연 없는 통화 연결
4. **무중단 업데이트**: 서비스 중단 없이 코드 업데이트
5. **장애 격리**: 하나의 통화 실패가 다른 통화에 영향 없음

## 아키텍처 설계

### 통화 = Actor

```
┌─────────────────────────────────────────────────────────────────┐
│                     AXD 301 Switch Architecture                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   사용자 A                              사용자 B                 │
│      │                                     │                     │
│      ▼                                     ▼                     │
│  ┌────────┐     ┌──────────────┐     ┌────────┐                │
│  │ Line   │────▶│  Call Actor  │◀────│ Line   │                │
│  │ Actor  │     │              │     │ Actor  │                │
│  └────────┘     │  • 통화 상태  │     └────────┘                │
│                 │  • 과금 정보  │                               │
│                 │  • 통화 품질  │                               │
│                 └──────────────┘                                │
│                                                                  │
│   각 통화는 독립적인 경량 프로세스 (Actor)                       │
│   메모리 약 300 words per process                               │
└─────────────────────────────────────────────────────────────────┘
```

### Supervisor 트리 구조

```
                    ┌─────────────────┐
                    │  System Sup     │
                    │  (one_for_one)  │
                    └────────┬────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
    ┌────┴────┐        ┌─────┴─────┐       ┌────┴────┐
    │ Switch  │        │  Billing  │       │ Admin   │
    │   Sup   │        │    Sup    │       │  Sup    │
    └────┬────┘        └─────┬─────┘       └────┬────┘
         │                   │                  │
    ┌────┼────┐         ┌────┼────┐        ┌───┴───┐
    │    │    │         │    │    │        │       │
   ┌┴┐  ┌┴┐  ┌┴┐      ┌┴┐  ┌┴┐  ┌┴┐     ┌┴┐    ┌┴┐
   │C│  │C│  │C│      │B│  │B│  │B│     │A│    │A│
   └─┘  └─┘  └─┘      └─┘  └─┘  └─┘     └─┘    └─┘

   C = Call Handler
   B = Billing Process
   A = Admin Process
```

## Erlang 코드 예시

### Call Handler Actor

```erlang
-module(call_handler).
-behaviour(gen_statem).

%% API
-export([start_link/1, dial/2, answer/1, hangup/1]).

%% gen_statem callbacks
-export([init/1, callback_mode/0, idle/3, ringing/3, connected/3]).

-record(call_state, {
    caller_id,
    callee_id,
    start_time,
    billing_ref
}).

%% ============================================
%% API Functions
%% ============================================

start_link(CallerId) ->
    gen_statem:start_link(?MODULE, [CallerId], []).

dial(Pid, CalleeId) ->
    gen_statem:call(Pid, {dial, CalleeId}).

answer(Pid) ->
    gen_statem:call(Pid, answer).

hangup(Pid) ->
    gen_statem:cast(Pid, hangup).

%% ============================================
%% gen_statem Callbacks
%% ============================================

init([CallerId]) ->
    {ok, idle, #call_state{caller_id = CallerId}}.

callback_mode() -> state_functions.

%% Idle State
idle({call, From}, {dial, CalleeId}, State) ->
    case find_callee(CalleeId) of
        {ok, CalleePid} ->
            %% 상대방에게 링 시작
            ring_callee(CalleePid, State#call_state.caller_id),
            {next_state, ringing,
             State#call_state{callee_id = CalleeId},
             [{reply, From, ringing}]};
        {error, not_found} ->
            {keep_state, State, [{reply, From, {error, not_found}}]}
    end;

idle(cast, hangup, _State) ->
    {stop, normal}.

%% Ringing State
ringing({call, From}, answer, State) ->
    StartTime = erlang:system_time(second),
    %% 과금 시작
    BillingRef = billing:start_call(State#call_state.caller_id,
                                     State#call_state.callee_id),
    {next_state, connected,
     State#call_state{start_time = StartTime, billing_ref = BillingRef},
     [{reply, From, connected}]};

ringing(cast, hangup, State) ->
    notify_callee_hangup(State#call_state.callee_id),
    {stop, normal}.

%% Connected State
connected(cast, hangup, State) ->
    Duration = erlang:system_time(second) - State#call_state.start_time,
    billing:end_call(State#call_state.billing_ref, Duration),
    notify_callee_hangup(State#call_state.callee_id),
    {stop, normal}.

%% Helper functions
find_callee(CalleeId) ->
    %% 실제로는 분산 레지스트리 조회
    case whereis(CalleeId) of
        undefined -> {error, not_found};
        Pid -> {ok, Pid}
    end.

ring_callee(Pid, CallerId) ->
    gen_statem:cast(Pid, {incoming_call, CallerId}).

notify_callee_hangup(CalleeId) ->
    case whereis(CalleeId) of
        undefined -> ok;
        Pid -> gen_statem:cast(Pid, peer_hangup)
    end.
```

### Supervisor 설정

```erlang
-module(call_sup).
-behaviour(supervisor).

-export([start_link/0, start_call/1]).
-export([init/1]).

start_link() ->
    supervisor:start_link({local, ?MODULE}, ?MODULE, []).

start_call(CallerId) ->
    supervisor:start_child(?MODULE, [CallerId]).

init([]) ->
    SupFlags = #{
        strategy => simple_one_for_one,  % 동적 자식 생성
        intensity => 10,                  % 10번 재시작
        period => 60                      % 60초 내
    },
    ChildSpec = #{
        id => call_handler,
        start => {call_handler, start_link, []},
        restart => temporary,             % 통화 종료 시 재시작 안함
        shutdown => 5000,
        type => worker
    }.
    {ok, {SupFlags, [ChildSpec]}}.
```

## 성능 특성

### Nine Nines 가용성

```
99.9999999% 가용성 = 연간 31.5ms 다운타임

┌──────────────────────────────────────────────────────────────┐
│                    가용성 계산                                │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│   99.9%      = 8시간 46분/년 다운타임                        │
│   99.99%     = 52분 36초/년                                  │
│   99.999%    = 5분 16초/년                                   │
│   99.9999%   = 31.5초/년                                     │
│   99.99999%  = 3.15초/년                                     │
│   99.999999% = 315ms/년                                      │
│   99.9999999%= 31.5ms/년    ◀── Ericsson AXD 301            │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

### 달성 방법

1. **장애 격리**
```
통화 A 장애 발생
    │
    ▼
┌─────────┐
│ Call A  │ ←── 재시작
└─────────┘
    │
    ▼
다른 통화 영향 없음
```

2. **Hot Code Swapping**
```
Version 1.0 실행 중
        │
   새 코드 배포
        │
        ▼
┌────────────────────────────────────────┐
│  진행 중인 통화: Version 1.0 유지      │
│  새로운 통화: Version 2.0 사용         │
└────────────────────────────────────────┘
        │
   기존 통화 종료 시
        │
        ▼
   전체 Version 2.0
```

3. **무한 확장성**
```
서버 1          서버 2          서버 3
┌─────┐        ┌─────┐        ┌─────┐
│█████│        │█████│        │█████│
│█████│        │█████│        │     │
│█████│        │     │        │     │
└─────┘        └─────┘        └─────┘
  90%            60%            30%

분산 Erlang 클러스터로 투명한 확장
```

## 현대 통신 시스템 적용

### 5G 코어 네트워크

```
┌─────────────────────────────────────────────────────────────────┐
│                     5G Core Network Functions                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐          │
│   │   AMF   │  │   SMF   │  │   UPF   │  │   PCF   │          │
│   │  Actor  │  │  Actor  │  │  Actor  │  │  Actor  │          │
│   └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘          │
│        │            │            │            │                 │
│        └────────────┴─────┬──────┴────────────┘                 │
│                           │                                      │
│                    Service Mesh                                  │
│                                                                  │
│   AMF = Access and Mobility Management                          │
│   SMF = Session Management Function                             │
│   UPF = User Plane Function                                     │
│   PCF = Policy Control Function                                 │
└─────────────────────────────────────────────────────────────────┘
```

### VoIP 시스템

많은 현대 VoIP 시스템이 Erlang/Elixir 기반:

- **FreeSWITCH**: 대규모 VoIP 스위치
- **Kazoo**: 클라우드 텔레포니 플랫폼
- **Plivo**: 클라우드 통신 플랫폼

## 교훈과 적용

### 통신 시스템에서 배운 교훈

1. **"Let it Crash"**: 복구 가능한 장애는 빠르게 실패하고 재시작
2. **격리의 중요성**: 한 사용자의 문제가 전체에 영향 없음
3. **상태 최소화**: 프로세스별 상태를 최소화하여 복구 용이
4. **메시지 기반 통신**: 동기화 없는 안전한 통신

### 다른 분야 적용

이러한 원칙은 현재 다양한 분야에 적용됨:
- **금융**: 거래 처리 시스템
- **게임**: 실시간 멀티플레이어
- **IoT**: 디바이스 관리
- **소셜**: 메시징 시스템

## 참고 자료

- [Erlang: The Movie](https://www.youtube.com/watch?v=xrIjfIjssLE)
- [Making reliable distributed systems in the presence of software errors](https://erlang.org/download/armstrong_thesis_2003.pdf) - Joe Armstrong 박사 논문
- [Ericsson AXD 301 Case Study](https://www.ericsson.com)
