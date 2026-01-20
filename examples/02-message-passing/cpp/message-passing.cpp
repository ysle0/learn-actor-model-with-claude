/**
 * Message Passing Patterns - Tell, Ask, Forward in C++
 * CAF (C++ Actor Framework) 스타일로 구현
 *
 * 컴파일: g++ -std=c++17 message-passing.cpp -lcaf_core -o message-passing
 */

#include <iostream>
#include <string>
#include <map>
#include <vector>
#include <functional>
#include <memory>
#include <queue>
#include <thread>
#include <chrono>
#include <random>
#include <mutex>

// ============================================
// 메시지 타입 정의
// ============================================

struct CreateOrder {
    std::string order_id;
    double amount;
};

struct OrderCreated {
    std::string order_id;
    std::string status;
};

struct PaymentResult {
    std::string order_id;
    bool success;
};

struct ValidatePayment {
    std::string order_id;
    double amount;
};

struct ProcessPayment {
    std::string order_id;
    double amount;
};

struct PaymentResponse {
    bool success;
    std::string transaction_id;
};

struct ShipOrder {
    std::string order_id;
    std::string address;
};

struct Notify {
    std::string message;
};

// ============================================
// 간단한 Actor 시스템
// ============================================

class Actor;
using ActorRef = std::shared_ptr<Actor>;

class Actor : public std::enable_shared_from_this<Actor> {
public:
    virtual ~Actor() = default;
    virtual void receive(const std::any& msg, std::function<void(std::any)> reply = nullptr) = 0;

    void tell(const std::any& msg) {
        receive(msg, nullptr);
    }

    template<typename R>
    R ask(const std::any& msg) {
        R result;
        bool received = false;
        receive(msg, [&](std::any response) {
            result = std::any_cast<R>(response);
            received = true;
        });
        return result;
    }
};

class ActorSystem {
public:
    void spawn(const std::string& name, ActorRef actor) {
        std::lock_guard<std::mutex> lock(mutex_);
        actors_[name] = actor;
    }

    ActorRef get(const std::string& name) {
        std::lock_guard<std::mutex> lock(mutex_);
        auto it = actors_.find(name);
        return it != actors_.end() ? it->second : nullptr;
    }

    static ActorSystem& instance() {
        static ActorSystem system;
        return system;
    }

private:
    std::map<std::string, ActorRef> actors_;
    std::mutex mutex_;
};

// ============================================
// Actor 구현
// ============================================

// OrderActor
class OrderActor : public Actor {
public:
    void receive(const std::any& msg, std::function<void(std::any)> reply) override {
        std::lock_guard<std::mutex> lock(mutex_);

        if (msg.type() == typeid(CreateOrder)) {
            auto order = std::any_cast<CreateOrder>(msg);
            std::cout << "[OrderActor] Creating order: " << order.order_id << "\n";

            orders_[order.order_id] = {"pending", order.amount};

            // Tell 패턴: PaymentActor에게 검증 요청
            auto payment = ActorSystem::instance().get("payment");
            if (payment) {
                std::thread([payment, order]() {
                    payment->tell(ValidatePayment{order.order_id, order.amount});
                }).detach();
            }

            if (reply) {
                reply(OrderCreated{order.order_id, "processing"});
            }
        }
        else if (msg.type() == typeid(PaymentResult)) {
            auto result = std::any_cast<PaymentResult>(msg);
            std::cout << "[OrderActor] Payment result for " << result.order_id
                      << ": " << (result.success ? "success" : "failed") << "\n";

            auto it = orders_.find(result.order_id);
            if (it != orders_.end()) {
                if (result.success) {
                    it->second.status = "paid";

                    // Forward 패턴: ShippingActor에게 전달
                    auto shipping = ActorSystem::instance().get("shipping");
                    if (shipping) {
                        std::thread([shipping, result]() {
                            shipping->tell(ShipOrder{result.order_id, "123 Main St"});
                        }).detach();
                    }
                } else {
                    it->second.status = "payment_failed";
                }
            }
        }
    }

private:
    struct OrderInfo {
        std::string status;
        double amount;
    };

    std::map<std::string, OrderInfo> orders_;
    std::mutex mutex_;
};

// PaymentActor
class PaymentActor : public Actor {
public:
    void receive(const std::any& msg, std::function<void(std::any)> reply) override {
        if (msg.type() == typeid(ValidatePayment)) {
            auto payment = std::any_cast<ValidatePayment>(msg);
            std::cout << "[PaymentActor] Validating payment for order: " << payment.order_id << "\n";

            // 결제 처리 시뮬레이션
            std::this_thread::sleep_for(std::chrono::milliseconds(100));

            std::random_device rd;
            std::mt19937 gen(rd());
            std::uniform_real_distribution<> dis(0.0, 1.0);
            bool success = dis(gen) > 0.2;  // 80% 성공률

            std::cout << "[PaymentActor] Payment " << (success ? "approved" : "rejected") << "\n";

            // Tell 패턴: 결과를 OrderActor에게 알림
            auto order = ActorSystem::instance().get("order");
            if (order) {
                std::thread([order, payment, success]() {
                    order->tell(PaymentResult{payment.order_id, success});
                }).detach();
            }
        }
        else if (msg.type() == typeid(ProcessPayment)) {
            auto payment = std::any_cast<ProcessPayment>(msg);
            std::cout << "[PaymentActor] Processing payment: $" << payment.amount << "\n";

            std::this_thread::sleep_for(std::chrono::milliseconds(100));

            if (reply) {
                auto now = std::chrono::system_clock::now();
                auto timestamp = std::chrono::duration_cast<std::chrono::milliseconds>(
                    now.time_since_epoch()).count();
                reply(PaymentResponse{true, "TXN-" + std::to_string(timestamp)});
            }
        }
    }
};

// ShippingActor
class ShippingActor : public Actor {
public:
    void receive(const std::any& msg, std::function<void(std::any)> reply) override {
        std::lock_guard<std::mutex> lock(mutex_);

        if (msg.type() == typeid(ShipOrder)) {
            auto ship = std::any_cast<ShipOrder>(msg);
            std::cout << "[ShippingActor] Shipping order " << ship.order_id
                      << " to " << ship.address << "\n";
            shipments_[ship.order_id] = {"shipped", ship.address};
        }
    }

private:
    struct ShipmentInfo {
        std::string status;
        std::string address;
    };

    std::map<std::string, ShipmentInfo> shipments_;
    std::mutex mutex_;
};

// NotificationActor
class NotificationActor : public Actor {
public:
    explicit NotificationActor(const std::string& name) : name_(name) {}

    void receive(const std::any& msg, std::function<void(std::any)> reply) override {
        if (msg.type() == typeid(Notify)) {
            auto notification = std::any_cast<Notify>(msg);
            std::cout << "[" << name_ << "] Received notification: "
                      << notification.message << "\n";
        }
    }

private:
    std::string name_;
};

// BroadcasterActor
class BroadcasterActor : public Actor {
public:
    void broadcast(const std::string& message, const std::vector<ActorRef>& targets) {
        std::cout << "[Broadcaster] Broadcasting to " << targets.size() << " actors\n";
        for (const auto& target : targets) {
            std::thread([target, message]() {
                target->tell(Notify{message});
            }).detach();
        }
    }

    void receive(const std::any& msg, std::function<void(std::any)> reply) override {
        // 이 Actor는 broadcast 메서드를 직접 호출
    }
};

// ============================================
// 메인 함수
// ============================================

int main() {
    std::cout << "=== Message Passing Patterns Demo (C++) ===\n\n";

    auto& system = ActorSystem::instance();

    // Actor 생성
    auto orderActor = std::make_shared<OrderActor>();
    auto paymentActor = std::make_shared<PaymentActor>();
    auto shippingActor = std::make_shared<ShippingActor>();

    system.spawn("order", orderActor);
    system.spawn("payment", paymentActor);
    system.spawn("shipping", shippingActor);

    std::cout << "--- 1. Tell Pattern (Fire-and-Forget) ---\n\n";

    // Tell: 응답 없이 메시지 전송
    orderActor->tell(CreateOrder{"ORD-001", 99.99});

    std::this_thread::sleep_for(std::chrono::milliseconds(500));

    std::cout << "\n--- 2. Ask Pattern (Request-Response) ---\n\n";

    // Ask: 응답 대기
    auto result = paymentActor->ask<PaymentResponse>(ProcessPayment{"ORD-002", 150.0});
    std::cout << "Payment result: Success=" << (result.success ? "true" : "false")
              << ", TxnID=" << result.transaction_id << "\n";

    std::cout << "\n--- 3. Broadcast Pattern ---\n\n";

    // Broadcast 설정
    auto notifier1 = std::make_shared<NotificationActor>("Notifier-1");
    auto notifier2 = std::make_shared<NotificationActor>("Notifier-2");
    auto notifier3 = std::make_shared<NotificationActor>("Notifier-3");
    auto broadcaster = std::make_shared<BroadcasterActor>();

    std::vector<ActorRef> targets = {notifier1, notifier2, notifier3};
    broadcaster->broadcast("System maintenance in 5 minutes", targets);

    std::this_thread::sleep_for(std::chrono::milliseconds(200));

    std::cout << "\n=== Demo Complete ===\n";

    return 0;
}
