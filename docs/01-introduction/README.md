# 01. Introduction - Actor Model 소개

> Actor Model은 동시성 프로그래밍을 위한 수학적 모델로, 모든 것을 "Actor"라는 독립적인 계산 단위로 표현합니다.

## 한 줄 요약

**"Actor는 메시지를 받으면 3가지를 할 수 있다: 새 Actor 생성, 메시지 전송, 다음 메시지 처리 방식 결정"**

---

## Actor Model이란?

Actor Model은 **동시성(concurrency)**과 **분산 컴퓨팅(distributed computing)**을 위한 프로그래밍 모델입니다.

```
┌─────────────────────────────────────────────────────────────────┐
│                     Actor의 3가지 행동                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  메시지 수신 시 Actor가 할 수 있는 일:                            │
│                                                                 │
│  1. 🔨 새로운 Actor 생성 (Create)                                │
│     └─ 작업을 분할하거나 위임할 새 Actor를 만듦                    │
│                                                                 │
│  2. 📨 다른 Actor에게 메시지 전송 (Send)                          │
│     └─ 비동기로 다른 Actor와 통신                                 │
│                                                                 │
│  3. 🔄 다음 메시지 처리 방식 결정 (Become)                        │
│     └─ 자신의 상태/행동을 변경                                    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 핵심 특징

| 특징 | 설명 |
|------|------|
| **독립성** | 각 Actor는 자신만의 상태를 가지며 다른 Actor와 공유하지 않음 |
| **비동기 통신** | 메시지를 보내고 바로 리턴, 응답을 기다리지 않음 |
| **순차 처리** | 각 Actor는 한 번에 하나의 메시지만 처리 |
| **위치 투명성** | Actor가 어디에 있든 동일한 방식으로 통신 가능 |

---

## 왜 Actor Model이 필요한가?

### 전통적인 동시성 프로그래밍의 문제

```cpp
// ❌ 전통적인 방식: 공유 상태 + Lock
class Counter {
    int value = 0;
    std::mutex mtx;

public:
    void increment() {
        std::lock_guard<std::mutex> lock(mtx);  // Lock 필요
        value++;                                  // 공유 상태 수정
    }
};
```

**문제점:**
- 🔒 Lock 경합으로 성능 저하
- 💀 Deadlock 위험
- 🐛 Race Condition 디버깅 어려움
- 📈 확장성 한계

### Actor Model의 해결 방식

```cpp
// ✅ Actor 방식: 메시지로 통신
class CounterActor : public Actor {
    int value = 0;  // 내부 상태, 외부 접근 불가

    void receive(Message msg) {
        if (msg.type == "increment") {
            value++;  // Lock 없이 안전하게 수정
        }
    }
};
```

**장점:**
- 🚀 Lock-Free로 높은 성능
- ✅ Deadlock 없음 (Lock 자체가 없음)
- 🎯 단순한 프로그래밍 모델
- 📊 수평 확장 용이

---

## Actor Model의 실제 활용

### 적합한 사용 사례

```
✅ 높은 동시성이 필요한 시스템
   • 채팅 서버 (수백만 동시 접속)
   • 게임 서버 (수천 명의 플레이어)
   • IoT 디바이스 관리

✅ 분산 시스템
   • 마이크로서비스 아키텍처
   • 클러스터 컴퓨팅

✅ 장애 허용이 중요한 시스템
   • 금융 거래 시스템
   • 통신 인프라 (Erlang의 탄생 배경)
```

### 실제 사용 사례

| 회사/제품 | 기술 | 규모 |
|-----------|------|------|
| WhatsApp | Erlang | 20억+ 사용자, 900+ 서버 |
| Discord | Elixir | 1억+ 사용자 |
| Halo 4/5 | Orleans | 수백만 동시 접속 |
| LinkedIn | Akka | 실시간 알림 시스템 |

---

## 다음 단계

- 📖 [Actor Model의 역사](./history.md) - 1973년 Carl Hewitt부터 현재까지
- 🤔 [왜 Actor Model인가?](./why-actor-model.md) - 다른 동시성 모델과의 비교

---

## 참고 자료

- [Actor Model - Wikipedia](https://en.wikipedia.org/wiki/Actor_model)
- [The Actor Model in 10 minutes](https://www.brianstorti.com/the-actor-model/)
- [Carl Hewitt's Original Paper (1973)](https://dl.acm.org/doi/10.5555/1624775.1624804)
