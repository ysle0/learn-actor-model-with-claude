/**
 * Basic Actor Pattern - Counter Actor in C++ with CAF
 *
 * 빌드 방법:
 * g++ -std=c++17 counter.cpp -o counter -lcaf_core
 *
 * CAF 설치:
 * - Ubuntu: sudo apt install libcaf-dev
 * - macOS: brew install caf
 * - 또는 소스에서 빌드: https://github.com/actor-framework/actor-framework
 */

#include <iostream>

// CAF 없이 개념 데모를 위한 간단한 구현
// 실제 프로젝트에서는 CAF 사용 권장

#include <queue>
#include <mutex>
#include <thread>
#include <functional>
#include <variant>
#include <optional>
#include <condition_variable>

// ============================================
// Message Types (메시지 타입 정의)
// ============================================

struct Increment {};
struct Decrement {};
struct GetCount {
    std::function<void(int)> reply_to;
};
struct Reset {};

using Message = std::variant<Increment, Decrement, GetCount, Reset>;

// ============================================
// Simple Actor Base (간단한 Actor 기본 클래스)
// ============================================

template<typename Derived, typename MsgType>
class Actor {
protected:
    std::queue<MsgType> mailbox_;
    std::mutex mutex_;
    std::condition_variable cv_;
    bool running_ = true;
    std::thread worker_;

public:
    Actor() {
        worker_ = std::thread([this]() {
            while (running_ || !mailbox_.empty()) {
                std::unique_lock<std::mutex> lock(mutex_);
                cv_.wait(lock, [this]() {
                    return !mailbox_.empty() || !running_;
                });

                while (!mailbox_.empty()) {
                    auto msg = std::move(mailbox_.front());
                    mailbox_.pop();
                    lock.unlock();

                    static_cast<Derived*>(this)->receive(msg);

                    lock.lock();
                }
            }
        });
    }

    virtual ~Actor() {
        {
            std::lock_guard<std::mutex> lock(mutex_);
            running_ = false;
        }
        cv_.notify_one();
        if (worker_.joinable()) {
            worker_.join();
        }
    }

    // 메시지 전송 (Tell 패턴)
    void send(MsgType msg) {
        {
            std::lock_guard<std::mutex> lock(mutex_);
            mailbox_.push(std::move(msg));
        }
        cv_.notify_one();
    }
};

// ============================================
// Counter Actor (카운터 액터 구현)
// ============================================

class CounterActor : public Actor<CounterActor, Message> {
private:
    int count_ = 0;

public:
    void receive(const Message& msg) {
        std::visit([this](auto&& arg) {
            using T = std::decay_t<decltype(arg)>;

            if constexpr (std::is_same_v<T, Increment>) {
                count_++;
                std::cout << "Incremented: " << count_ << std::endl;
            }
            else if constexpr (std::is_same_v<T, Decrement>) {
                count_--;
                std::cout << "Decremented: " << count_ << std::endl;
            }
            else if constexpr (std::is_same_v<T, GetCount>) {
                if (arg.reply_to) {
                    arg.reply_to(count_);
                }
            }
            else if constexpr (std::is_same_v<T, Reset>) {
                count_ = 0;
                std::cout << "Reset to 0" << std::endl;
            }
        }, msg);
    }
};

// ============================================
// CAF 버전 (주석 처리 - CAF 설치 시 사용)
// ============================================

/*
#include <caf/all.hpp>

using namespace caf;

// Atom 정의 (메시지 타입)
using increment_atom = atom_constant<atom("inc")>;
using decrement_atom = atom_constant<atom("dec")>;
using get_atom = atom_constant<atom("get")>;
using reset_atom = atom_constant<atom("reset")>;

// Counter Actor 행위 정의
behavior counter_actor(stateful_actor<int>* self) {
    self->state = 0;  // 초기 상태

    return {
        [=](increment_atom) {
            self->state++;
            aout(self) << "Incremented: " << self->state << std::endl;
        },
        [=](decrement_atom) {
            self->state--;
            aout(self) << "Decremented: " << self->state << std::endl;
        },
        [=](get_atom) -> int {
            return self->state;
        },
        [=](reset_atom) {
            self->state = 0;
            aout(self) << "Reset to 0" << std::endl;
        }
    };
}

void caf_main(actor_system& sys) {
    // Actor 생성
    auto counter = sys.spawn(counter_actor);

    // scoped_actor로 동기적 통신
    scoped_actor self{sys};

    // Tell 패턴
    self->send(counter, increment_atom_v);
    self->send(counter, increment_atom_v);
    self->send(counter, increment_atom_v);
    self->send(counter, decrement_atom_v);

    // Ask 패턴
    self->request(counter, infinite, get_atom_v).receive(
        [](int count) {
            std::cout << "Current count: " << count << std::endl;
        },
        [](error& err) {
            std::cerr << "Error: " << to_string(err) << std::endl;
        }
    );

    // Reset
    self->send(counter, reset_atom_v);
}

CAF_MAIN()
*/

// ============================================
// 메인 함수 (간단한 구현 사용)
// ============================================

int main() {
    std::cout << "=== Counter Actor Example (C++) ===" << std::endl << std::endl;

    {
        CounterActor counter;

        // Tell 패턴: 응답 없이 메시지 전송
        counter.send(Increment{});
        counter.send(Increment{});
        counter.send(Increment{});
        counter.send(Decrement{});

        // 처리 대기
        std::this_thread::sleep_for(std::chrono::milliseconds(100));

        // Ask 패턴: 응답 대기
        std::promise<int> promise;
        auto future = promise.get_future();

        counter.send(GetCount{[&promise](int count) {
            promise.set_value(count);
        }});

        int result = future.get();
        std::cout << std::endl << "Final count: " << result << std::endl;

        // Reset
        counter.send(Reset{});

        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }

    std::cout << std::endl << "=== Demo Complete ===" << std::endl;

    return 0;
}
