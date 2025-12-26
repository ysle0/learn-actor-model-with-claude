# C++ Actor Framework (CAF) 분석

> 고성능 C++ Actor 라이브러리

## 개요

CAF(C++ Actor Framework)는 C++로 구현된 Actor Model 라이브러리입니다. 게임 엔진, 금융 시스템 등 고성능이 필요한 환경에서 사용됩니다.

## 특징

```
┌─────────────────────────────────────────────────────────────────┐
│                      CAF Features                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   • Type-safe 메시지 패싱                                        │
│   • 네트워크 투명성 (분산 지원)                                  │
│   • 가벼운 Actor (~200 bytes)                                   │
│   • 패턴 매칭 기반 메시지 처리                                   │
│   • C++17/20 현대 문법                                          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 기본 사용법

### Actor 정의

```cpp
#include <caf/all.hpp>
using namespace caf;

// 메시지 타입 정의
struct increment_atom_t {};
struct get_atom_t {};

using increment_atom = atom_constant<increment_atom_t>;
using get_atom = atom_constant<get_atom_t>;

// Actor behavior 정의
behavior counter(stateful_actor<int>* self) {
    self->state = 0;
    return {
        [=](increment_atom) {
            ++self->state;
        },
        [=](get_atom) {
            return self->state;
        }
    };
}

void caf_main(actor_system& sys) {
    auto c = sys.spawn(counter);

    // Fire-and-forget
    anon_send(c, increment_atom_v);
    anon_send(c, increment_atom_v);

    // Request-response
    scoped_actor self{sys};
    self->request(c, infinite, get_atom_v).receive(
        [](int value) {
            std::cout << "Count: " << value << std::endl;
        },
        [](error& err) {
            std::cerr << "Error: " << to_string(err) << std::endl;
        }
    );
}

CAF_MAIN()
```

### 타입 안전 메시지

```cpp
// 메시지 타입 정의
using add_atom = atom_constant<atom("add")>;
using result_atom = atom_constant<atom("result")>;

// typed actor
using calculator_type = typed_actor<
    result<int>(add_atom, int, int),
    result<int>(atom_constant<atom("sub")>, int, int)
>;

calculator_type::behavior_type calculator_impl() {
    return {
        [](add_atom, int a, int b) {
            return a + b;
        },
        [](atom_constant<atom("sub")>, int a, int b) {
            return a - b;
        }
    };
}
```

### 분산 Actor

```cpp
// 노드 설정
void run_server(actor_system& sys, uint16_t port) {
    auto res = sys.middleman().publish_local_groups(port);
    if (!res) {
        std::cerr << "Failed to publish: " << to_string(res.error()) << std::endl;
        return;
    }

    auto calc = sys.spawn(calculator_impl);
    sys.middleman().publish(calc, port, nullptr, true);
}

void run_client(actor_system& sys, const std::string& host, uint16_t port) {
    auto calc = sys.middleman().remote_actor<calculator_type>(host, port);
    if (!calc) {
        std::cerr << "Failed to connect" << std::endl;
        return;
    }

    scoped_actor self{sys};
    self->request(*calc, infinite, add_atom_v, 1, 2).receive(
        [](int result) {
            std::cout << "1 + 2 = " << result << std::endl;
        },
        [](error& err) {
            std::cerr << "Error: " << to_string(err) << std::endl;
        }
    );
}
```

## 게임 개발 예시

```cpp
// 플레이어 Actor
struct player_state {
    std::string name;
    int hp = 100;
    position pos{0, 0, 0};
    std::vector<item> inventory;
};

using player_actor = stateful_actor<player_state>;

behavior player(player_actor* self, const std::string& name) {
    self->state.name = name;

    return {
        [=](move_atom, direction dir) {
            self->state.pos = calculate_new_position(self->state.pos, dir);
            // 주변 플레이어에게 알림
            self->send(zone_actor, broadcast_atom_v, self->id(),
                       position_update{self->state.pos});
        },

        [=](attack_atom, actor_addr target, int damage) {
            self->send(actor_cast<actor>(target), take_damage_atom_v, damage);
        },

        [=](take_damage_atom, int damage) {
            self->state.hp -= damage;
            if (self->state.hp <= 0) {
                self->send(self, die_atom_v);
            }
            return self->state.hp;
        },

        [=](die_atom) {
            // 사망 처리
            self->send(zone_actor, player_died_atom_v, self->id());
            self->quit();
        }
    };
}
```

## 설정

### CMakeLists.txt

```cmake
cmake_minimum_required(VERSION 3.16)
project(game_server)

find_package(CAF REQUIRED COMPONENTS core io)

add_executable(server main.cpp)
target_link_libraries(server CAF::core CAF::io)
```

## 성능

```
단일 노드 벤치마크:
• 메시지 처리: ~10M msg/sec
• Actor 생성: ~1M actors/sec
• 메모리: ~200 bytes/actor

특성:
• Zero-copy 메시지 전달 (로컬)
• Lock-free 메일박스
• Work-stealing 스케줄러
```

## 관련 문서

- [프레임워크 비교](../05-frameworks/comparison-table.md)
- [게임 서버 아키텍처](../06-game-server/architecture-patterns.md)
