# Erlang/OTP

> Actor Model의 원조, 통신 시스템을 위해 설계된 언어

## 개요

Erlang은 1986년 Ericsson에서 통신 시스템을 위해 개발된 언어입니다. OTP(Open Telecom Platform)는 Erlang의 표준 라이브러리이자 설계 원칙의 모음입니다.

```
┌─────────────────────────────────────────────────────────────────┐
│                    Erlang/OTP Stack                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │                   Applications                           │   │
│   │    (WhatsApp, Discord, RabbitMQ, CouchDB...)            │   │
│   └─────────────────────────────────────────────────────────┘   │
│                           │                                      │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │                     OTP Framework                        │   │
│   │    (Behaviors, Supervisors, Applications)               │   │
│   └─────────────────────────────────────────────────────────┘   │
│                           │                                      │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │                   Erlang Language                        │   │
│   │    (Processes, Pattern Matching, Hot Code Swap)         │   │
│   └─────────────────────────────────────────────────────────┘   │
│                           │                                      │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │                     BEAM VM                              │   │
│   │    (Scheduler, Garbage Collection, Distribution)        │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 핵심 특징

### 1. 경량 프로세스

```erlang
%% 프로세스 생성 (약 300 words 메모리)
Pid = spawn(fun() ->
    receive
        {From, Message} ->
            From ! {self(), "Got: " ++ Message}
    end
end).

%% 메시지 전송
Pid ! {self(), "Hello"}.

%% 응답 수신
receive
    {Pid, Response} ->
        io:format("Response: ~s~n", [Response])
end.
```

### 2. Pattern Matching

```erlang
%% 메시지 패턴 매칭
handle_message(Message) ->
    case Message of
        {deposit, Amount} when Amount > 0 ->
            {ok, deposit(Amount)};
        {withdraw, Amount} when Amount > 0 ->
            {ok, withdraw(Amount)};
        {balance} ->
            {ok, get_balance()};
        _ ->
            {error, unknown_message}
    end.
```

### 3. Hot Code Swapping

```erlang
%% 실행 중 코드 업데이트
%% old version이 실행 중이어도 new version 로드 가능

-module(counter).
-export([start/0, loop/1]).

start() ->
    spawn(?MODULE, loop, [0]).

loop(Count) ->
    receive
        increment ->
            ?MODULE:loop(Count + 1);  %% 새 버전으로 전환
        {get, From} ->
            From ! Count,
            ?MODULE:loop(Count)
    end.
```

## OTP Behaviors

### gen_server

가장 많이 사용되는 일반 서버 패턴:

```erlang
-module(counter_server).
-behaviour(gen_server).

%% API
-export([start_link/0, increment/0, get_count/0]).

%% gen_server callbacks
-export([init/1, handle_call/3, handle_cast/2]).

%%% API %%%

start_link() ->
    gen_server:start_link({local, ?MODULE}, ?MODULE, [], []).

increment() ->
    gen_server:cast(?MODULE, increment).

get_count() ->
    gen_server:call(?MODULE, get_count).

%%% Callbacks %%%

init([]) ->
    {ok, #{count => 0}}.

handle_call(get_count, _From, State = #{count := Count}) ->
    {reply, Count, State}.

handle_cast(increment, State = #{count := Count}) ->
    {noreply, State#{count := Count + 1}}.
```

### gen_statem

상태 머신 구현:

```erlang
-module(door).
-behaviour(gen_statem).

-export([start_link/0, push/0, coin/0]).
-export([init/1, callback_mode/0, locked/3, unlocked/3]).

start_link() ->
    gen_statem:start_link({local, ?MODULE}, ?MODULE, [], []).

push() -> gen_statem:call(?MODULE, push).
coin() -> gen_statem:call(?MODULE, coin).

init([]) ->
    {ok, locked, #{}}.

callback_mode() -> state_functions.

%% Locked 상태
locked({call, From}, push, Data) ->
    {keep_state, Data, [{reply, From, locked}]};
locked({call, From}, coin, Data) ->
    {next_state, unlocked, Data, [{reply, From, unlocked}]}.

%% Unlocked 상태
unlocked({call, From}, push, Data) ->
    {next_state, locked, Data, [{reply, From, locked}]};
unlocked({call, From}, coin, Data) ->
    {keep_state, Data, [{reply, From, unlocked}]}.
```

### supervisor

자식 프로세스 관리:

```erlang
-module(my_sup).
-behaviour(supervisor).

-export([start_link/0, init/1]).

start_link() ->
    supervisor:start_link({local, ?MODULE}, ?MODULE, []).

init([]) ->
    SupFlags = #{
        strategy => one_for_one,
        intensity => 10,
        period => 60
    },

    Children = [
        #{
            id => counter,
            start => {counter_server, start_link, []},
            restart => permanent,
            shutdown => 5000,
            type => worker
        }
    ],

    {ok, {SupFlags, Children}}.
```

## 분산 Erlang

```erlang
%% 노드 시작
%% $ erl -name node1@192.168.1.1 -setcookie secret

%% 다른 노드 연결
net_adm:ping('node2@192.168.1.2').

%% 원격 노드에서 프로세스 생성
RemotePid = spawn('node2@192.168.1.2', fun() ->
    receive
        Msg -> io:format("Got: ~p~n", [Msg])
    end
end).

%% 원격 프로세스에 메시지 전송
RemotePid ! {hello, from_node1}.
```

## 장단점

### 장점

| 장점 | 설명 |
|------|------|
| 검증된 안정성 | 30년 이상 통신 시스템에서 검증 |
| Nine Nines | 99.9999999% 가용성 달성 사례 |
| Hot Code Swap | 무중단 배포 가능 |
| 분산 기본 지원 | 언어 레벨 분산 프로그래밍 |
| 패턴 매칭 | 선언적 메시지 처리 |

### 단점

| 단점 | 설명 |
|------|------|
| 학습 곡선 | 함수형 + 특수 문법 |
| 생태계 | JVM, .NET 대비 작음 |
| 타입 시스템 | 동적 타입 (Dialyzer로 보완) |
| 성능 | 순수 계산은 C/Go 대비 느림 |

## 사용 사례

```
┌─────────────────────────────────────────────────────────────────┐
│                   Erlang 사용 기업                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   WhatsApp     - 900M+ 사용자, 50명 엔지니어                   │
│   Discord      - 1억 5천만 MAU, Elixir (Erlang VM)             │
│   Ericsson     - 전화 교환기, AXD 301                          │
│   RabbitMQ     - 메시지 브로커                                  │
│   CouchDB      - NoSQL 데이터베이스                             │
│   Riak         - 분산 데이터베이스                              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Elixir

Erlang VM 위에서 동작하는 현대적 언어:

```elixir
# Elixir - 더 친숙한 문법
defmodule Counter do
  use GenServer

  def start_link(initial) do
    GenServer.start_link(__MODULE__, initial, name: __MODULE__)
  end

  def increment do
    GenServer.cast(__MODULE__, :increment)
  end

  def get do
    GenServer.call(__MODULE__, :get)
  end

  # Callbacks
  def init(initial), do: {:ok, initial}

  def handle_cast(:increment, count) do
    {:noreply, count + 1}
  end

  def handle_call(:get, _from, count) do
    {:reply, count, count}
  end
end
```

## 시작하기

```bash
# Erlang 설치
# Ubuntu
sudo apt-get install erlang

# macOS
brew install erlang

# 인터랙티브 셸 시작
erl

# 컴파일 및 실행
erlc my_module.erl
erl -noshell -s my_module start -s init stop
```

## 관련 문서

- [프레임워크 비교](./comparison-table.md)
- [Akka](./akka.md)
- [Let it Crash 철학](../04-supervision/let-it-crash.md)
