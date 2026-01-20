/**
 * Supervision Pattern - 감독 트리 예제 in C++
 * CAF 스타일로 구현
 *
 * 컴파일: g++ -std=c++17 supervision.cpp -o supervision -pthread
 */

#include <iostream>
#include <string>
#include <map>
#include <vector>
#include <memory>
#include <functional>
#include <chrono>
#include <thread>
#include <mutex>
#include <stdexcept>
#include <random>

// ============================================
// 감독 전략 정의
// ============================================

enum class Directive {
    Resume,
    Restart,
    Stop,
    Escalate
};

std::string directiveToString(Directive d) {
    switch (d) {
        case Directive::Resume: return "RESUME";
        case Directive::Restart: return "RESTART";
        case Directive::Stop: return "STOP";
        case Directive::Escalate: return "ESCALATE";
        default: return "UNKNOWN";
    }
}

using Decider = std::function<Directive(const std::exception&)>;

struct SupervisorStrategy {
    std::string type; // "one-for-one" or "all-for-one"
    int maxRetries;
    std::chrono::milliseconds withinDuration;
    Decider decider;
};

// ============================================
// 재시작 통계
// ============================================

class RestartStatistics {
public:
    RestartStatistics(int maxRetries, std::chrono::milliseconds withinDuration)
        : maxRetries_(maxRetries), withinDuration_(withinDuration) {}

    bool recordFailure() {
        std::lock_guard<std::mutex> lock(mutex_);
        auto now = std::chrono::steady_clock::now();
        failures_.push_back(now);

        // 시간 범위 내의 실패만 유지
        auto cutoff = now - withinDuration_;
        failures_.erase(
            std::remove_if(failures_.begin(), failures_.end(),
                [cutoff](const auto& t) { return t < cutoff; }),
            failures_.end()
        );

        return static_cast<int>(failures_.size()) <= maxRetries_;
    }

    void reset() {
        std::lock_guard<std::mutex> lock(mutex_);
        failures_.clear();
    }

private:
    std::vector<std::chrono::steady_clock::time_point> failures_;
    int maxRetries_;
    std::chrono::milliseconds withinDuration_;
    std::mutex mutex_;
};

// ============================================
// 에러 타입 정의
// ============================================

class TransientError : public std::runtime_error {
public:
    explicit TransientError(const std::string& msg) : std::runtime_error(msg) {}
};

class DatabaseError : public std::runtime_error {
public:
    explicit DatabaseError(const std::string& msg) : std::runtime_error(msg) {}
};

class FatalError : public std::runtime_error {
public:
    explicit FatalError(const std::string& msg) : std::runtime_error(msg) {}
};

// ============================================
// Actor 기본 클래스
// ============================================

class SupervisedActor;
using ActorPtr = std::shared_ptr<SupervisedActor>;

class SupervisedActor : public std::enable_shared_from_this<SupervisedActor> {
public:
    SupervisedActor(const std::string& name,
                    std::unique_ptr<SupervisorStrategy> strategy = nullptr)
        : name_(name), strategy_(std::move(strategy)), running_(true) {}

    virtual ~SupervisedActor() = default;

    ActorPtr spawn(const std::string& name, ActorPtr child) {
        std::lock_guard<std::mutex> lock(mutex_);
        child->parent_ = shared_from_this();
        children_[name] = child;

        if (strategy_) {
            restartStats_[name] = std::make_unique<RestartStatistics>(
                strategy_->maxRetries,
                strategy_->withinDuration
            );
        }

        std::cout << "[" << name_ << "] Spawned child: " << name << "\n";
        child->preStart();
        return child;
    }

    void send(const std::any& message) {
        if (!running_) {
            std::cout << "[" << name_ << "] Actor is stopped, message dropped\n";
            return;
        }

        try {
            receive(message);
        } catch (const std::exception& ex) {
            handleFailure(ex, message);
        }
    }

    virtual void receive(const std::any& message) = 0;

    virtual void preStart() {
        std::cout << "[" << name_ << "] Starting...\n";
    }

    virtual void postStop() {
        std::cout << "[" << name_ << "] Stopped\n";
    }

    virtual void preRestart(const std::exception& reason) {
        std::cout << "[" << name_ << "] Restarting due to: " << reason.what() << "\n";
        for (auto& [_, child] : children_) {
            child->stop();
        }
        postStop();
    }

    virtual void postRestart(const std::exception& reason) {
        preStart();
        std::cout << "[" << name_ << "] Restarted\n";
    }

    void stop() {
        std::vector<ActorPtr> childrenToStop;
        {
            std::lock_guard<std::mutex> lock(mutex_);
            running_ = false;
            for (auto& [_, child] : children_) {
                childrenToStop.push_back(child);
            }
            children_.clear();
        }

        for (auto& child : childrenToStop) {
            child->stop();
        }
        postStop();
    }

    const std::string& getName() const { return name_; }

protected:
    void handleFailure(const std::exception& error, const std::any& message) {
        std::cout << "[" << name_ << "] Failed with: " << error.what() << "\n";

        if (auto parent = parent_.lock()) {
            parent->supervise(name_, error, message);
        } else {
            std::cout << "[" << name_ << "] Root actor failure\n";
            stop();
        }
    }

    void supervise(const std::string& childName, const std::exception& error,
                   const std::any& message) {
        ActorPtr child;
        {
            std::lock_guard<std::mutex> lock(mutex_);
            auto it = children_.find(childName);
            if (it == children_.end() || !strategy_) return;
            child = it->second;
        }

        auto directive = strategy_->decider(error);
        std::cout << "[" << name_ << "] Supervising " << childName << ": "
                  << directiveToString(directive) << "\n";

        switch (directive) {
            case Directive::Resume:
                std::cout << "[" << name_ << "] Resuming " << childName << "\n";
                break;

            case Directive::Restart:
                handleRestart(childName, child, error);
                break;

            case Directive::Stop:
                handleStop(childName, child);
                break;

            case Directive::Escalate:
                if (auto parent = parent_.lock()) {
                    parent->supervise(name_, error, message);
                }
                break;
        }
    }

    void handleRestart(const std::string& childName, ActorPtr child,
                       const std::exception& error) {
        RestartStatistics* stats = nullptr;
        {
            std::lock_guard<std::mutex> lock(mutex_);
            auto it = restartStats_.find(childName);
            if (it != restartStats_.end()) {
                stats = it->second.get();
            }
        }

        if (stats && !stats->recordFailure()) {
            std::cout << "[" << name_ << "] Max retries exceeded for "
                      << childName << ", stopping\n";
            handleStop(childName, child);
            return;
        }

        if (strategy_ && strategy_->type == "all-for-one") {
            std::cout << "[" << name_ << "] All-for-one: restarting all children\n";
            std::lock_guard<std::mutex> lock(mutex_);
            for (auto& [_, c] : children_) {
                c->preRestart(error);
                c->postRestart(error);
            }
        } else {
            child->preRestart(error);
            child->postRestart(error);
        }
    }

    void handleStop(const std::string& childName, ActorPtr child) {
        child->stop();
        std::lock_guard<std::mutex> lock(mutex_);
        children_.erase(childName);
        restartStats_.erase(childName);
    }

    std::string name_;
    std::map<std::string, ActorPtr> children_;
    std::weak_ptr<SupervisedActor> parent_;
    std::unique_ptr<SupervisorStrategy> strategy_;
    std::map<std::string, std::unique_ptr<RestartStatistics>> restartStats_;
    bool running_;
    std::mutex mutex_;
};

// ============================================
// 메시지 타입 정의
// ============================================

struct ProcessJob {
    std::string data;
};

struct DispatchJob {
    std::string data;
};

struct QueryMessage {
    std::string sql;
};

// ============================================
// Actor 구현
// ============================================

class WorkerActor : public SupervisedActor {
public:
    explicit WorkerActor(const std::string& name)
        : SupervisedActor(name), jobCount_(0) {}

    void receive(const std::any& message) override {
        if (message.type() == typeid(ProcessJob)) {
            auto job = std::any_cast<ProcessJob>(message);
            jobCount_++;
            std::cout << "[" << name_ << "] Processing job #" << jobCount_
                      << ": " << job.data << "\n";

            if (job.data == "transient_error") {
                throw TransientError("Temporary network issue");
            }
            if (job.data == "fatal_error") {
                throw FatalError("Critical system failure");
            }

            std::cout << "[" << name_ << "] Job #" << jobCount_ << " completed\n";
        }
    }

    void preRestart(const std::exception& reason) override {
        std::cout << "[" << name_ << "] Saving state before restart... "
                  << "(jobs processed: " << jobCount_ << ")\n";
        SupervisedActor::preRestart(reason);
    }

    void postRestart(const std::exception& reason) override {
        jobCount_ = 0;
        SupervisedActor::postRestart(reason);
    }

private:
    int jobCount_;
};

class DatabaseActor : public SupervisedActor {
public:
    explicit DatabaseActor(const std::string& name)
        : SupervisedActor(name), connectionPool_(5) {}

    void receive(const std::any& message) override {
        if (message.type() == typeid(QueryMessage)) {
            auto query = std::any_cast<QueryMessage>(message);
            std::cout << "[" << name_ << "] Executing query: " << query.sql << "\n";

            if (query.sql == "bad_query") {
                throw DatabaseError("Query syntax error");
            }

            std::cout << "[" << name_ << "] Query completed\n";
        }
    }

    void preRestart(const std::exception& reason) override {
        std::cout << "[" << name_ << "] Keeping connection pool: "
                  << connectionPool_ << "\n";
    }

private:
    int connectionPool_;
};

class WorkerSupervisor : public SupervisedActor {
public:
    WorkerSupervisor() : SupervisedActor("WorkerSupervisor", createStrategy()) {}

    void receive(const std::any& message) override {
        if (message.type() == typeid(DispatchJob)) {
            auto dispatch = std::any_cast<DispatchJob>(message);

            std::vector<ActorPtr> workers;
            {
                std::lock_guard<std::mutex> lock(mutex_);
                for (auto& [_, child] : children_) {
                    workers.push_back(child);
                }
            }

            if (!workers.empty()) {
                static std::random_device rd;
                static std::mt19937 gen(rd());
                std::uniform_int_distribution<> dis(0, workers.size() - 1);
                workers[dis(gen)]->send(ProcessJob{dispatch.data});
            }
        }
    }

    void initWorkers(int count) {
        for (int i = 1; i <= count; i++) {
            auto name = "Worker-" + std::to_string(i);
            spawn(name, std::make_shared<WorkerActor>(name));
        }
    }

private:
    static std::unique_ptr<SupervisorStrategy> createStrategy() {
        auto strategy = std::make_unique<SupervisorStrategy>();
        strategy->type = "one-for-one";
        strategy->maxRetries = 3;
        strategy->withinDuration = std::chrono::minutes(1);
        strategy->decider = [](const std::exception& error) {
            if (dynamic_cast<const TransientError*>(&error)) {
                return Directive::Restart;
            }
            if (dynamic_cast<const FatalError*>(&error)) {
                return Directive::Stop;
            }
            return Directive::Escalate;
        };
        return strategy;
    }
};

class RootSupervisor : public SupervisedActor {
public:
    RootSupervisor() : SupervisedActor("RootSupervisor", createStrategy()) {}

    void receive(const std::any& message) override {
        std::cout << "[" << name_ << "] Received message\n";
    }

private:
    static std::unique_ptr<SupervisorStrategy> createStrategy() {
        auto strategy = std::make_unique<SupervisorStrategy>();
        strategy->type = "one-for-one";
        strategy->maxRetries = 5;
        strategy->withinDuration = std::chrono::minutes(1);
        strategy->decider = [](const std::exception& error) {
            std::cout << "[RootSupervisor] Deciding for error type\n";
            if (dynamic_cast<const DatabaseError*>(&error)) {
                return Directive::Resume;
            }
            return Directive::Restart;
        };
        return strategy;
    }
};

// ============================================
// 메인 함수
// ============================================

int main() {
    std::cout << "=== Supervision Pattern Demo (C++) ===\n\n";

    // 감독 트리 구성
    auto root = std::make_shared<RootSupervisor>();
    root->preStart();

    auto workerSupervisor = std::make_shared<WorkerSupervisor>();
    root->spawn("WorkerSupervisor", workerSupervisor);

    auto database = std::make_shared<DatabaseActor>("Database");
    root->spawn("Database", database);

    // 워커 초기화
    workerSupervisor->initWorkers(3);

    std::cout << "\n--- 1. Normal Operation ---\n\n";

    workerSupervisor->send(DispatchJob{"job-1"});
    workerSupervisor->send(DispatchJob{"job-2"});
    database->send(QueryMessage{"SELECT * FROM users"});

    std::this_thread::sleep_for(std::chrono::milliseconds(100));

    std::cout << "\n--- 2. Transient Error (Restart) ---\n\n";

    workerSupervisor->send(DispatchJob{"transient_error"});

    std::this_thread::sleep_for(std::chrono::milliseconds(100));

    std::cout << "\n--- 3. Database Error (Resume) ---\n\n";

    database->send(QueryMessage{"bad_query"});

    std::this_thread::sleep_for(std::chrono::milliseconds(100));

    std::cout << "\n--- 4. Normal Operation After Recovery ---\n\n";

    workerSupervisor->send(DispatchJob{"job-3"});
    database->send(QueryMessage{"SELECT * FROM orders"});

    std::this_thread::sleep_for(std::chrono::milliseconds(100));

    std::cout << "\n--- 5. Fatal Error (Stop) ---\n\n";

    workerSupervisor->send(DispatchJob{"fatal_error"});

    std::this_thread::sleep_for(std::chrono::milliseconds(100));

    std::cout << "\n--- 6. System Shutdown ---\n\n";

    root->stop();

    std::cout << "\n=== Demo Complete ===\n";

    return 0;
}
