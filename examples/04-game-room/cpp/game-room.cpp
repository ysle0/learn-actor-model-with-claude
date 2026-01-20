/**
 * Game Room Actor Pattern - 멀티플레이어 게임 룸 예제 in C++
 * CAF 스타일로 구현
 *
 * 컴파일: g++ -std=c++17 game-room.cpp -o game-room -pthread
 */

#include <iostream>
#include <string>
#include <map>
#include <memory>
#include <functional>
#include <thread>
#include <chrono>
#include <mutex>
#include <any>

// ============================================
// 타입 정의
// ============================================

enum class RoomStatus {
    Waiting,
    Starting,
    Playing,
    Finished
};

std::string statusToString(RoomStatus status) {
    switch (status) {
        case RoomStatus::Waiting: return "waiting";
        case RoomStatus::Starting: return "starting";
        case RoomStatus::Playing: return "playing";
        case RoomStatus::Finished: return "finished";
        default: return "unknown";
    }
}

struct PlayerInfo {
    std::string playerId;
    std::string name;
    bool isReady = false;
    int score = 0;
};

// ============================================
// 메시지 타입
// ============================================

struct JoinRoom {
    std::string playerId;
    std::string playerName;
};

struct LeaveRoom {
    std::string playerId;
};

struct SetReady {
    std::string playerId;
    bool ready;
};

struct GameAction {
    std::string playerId;
    std::string actionType;
    int points;
};

struct StartGame {};

struct EndGame {
    std::string winnerId;
};

// Player 메시지
struct PlayerJoined {
    PlayerInfo player;
};

struct PlayerLeft {
    std::string playerId;
};

struct PlayerReadyChanged {
    std::string playerId;
    bool ready;
};

struct GameStarting {
    int countdown;
};

struct GameStarted {};

struct GameActionBroadcast {
    std::string playerId;
    std::string actionType;
    int points;
};

struct GameEnded {
    std::string winnerId;
    std::map<std::string, int> scores;
};

// ============================================
// Player Actor
// ============================================

class PlayerActor {
public:
    PlayerActor(const std::string& playerId, const std::string& name)
        : playerId_(playerId), name_(name) {}

    void receive(const std::any& msg) {
        if (msg.type() == typeid(PlayerJoined)) {
            auto m = std::any_cast<PlayerJoined>(msg);
            std::cout << "[Player " << name_ << "] " << m.player.name << " joined the room\n";
        }
        else if (msg.type() == typeid(PlayerLeft)) {
            auto m = std::any_cast<PlayerLeft>(msg);
            std::cout << "[Player " << name_ << "] Player " << m.playerId << " left\n";
        }
        else if (msg.type() == typeid(PlayerReadyChanged)) {
            auto m = std::any_cast<PlayerReadyChanged>(msg);
            std::cout << "[Player " << name_ << "] Player " << m.playerId
                      << " is " << (m.ready ? "ready" : "not ready") << "\n";
        }
        else if (msg.type() == typeid(GameStarting)) {
            auto m = std::any_cast<GameStarting>(msg);
            std::cout << "[Player " << name_ << "] Game starting in " << m.countdown << "...\n";
        }
        else if (msg.type() == typeid(GameStarted)) {
            std::cout << "[Player " << name_ << "] Game started!\n";
        }
        else if (msg.type() == typeid(GameActionBroadcast)) {
            auto m = std::any_cast<GameActionBroadcast>(msg);
            std::cout << "[Player " << name_ << "] Received action from " << m.playerId << "\n";
        }
        else if (msg.type() == typeid(GameEnded)) {
            auto m = std::any_cast<GameEnded>(msg);
            std::string winner = m.winnerId.empty() ? "none" : m.winnerId;
            std::cout << "[Player " << name_ << "] Game ended! Winner: " << winner << "\n";
        }
    }

private:
    std::string playerId_;
    std::string name_;
};

// ============================================
// Room Actor
// ============================================

class RoomActor {
public:
    explicit RoomActor(const std::string& roomId)
        : roomId_(roomId), status_(RoomStatus::Waiting),
          maxPlayers_(4), minPlayers_(2) {}

    void receive(const std::any& msg) {
        std::lock_guard<std::mutex> lock(mutex_);

        if (msg.type() == typeid(JoinRoom)) {
            handleJoinRoom(std::any_cast<JoinRoom>(msg));
        }
        else if (msg.type() == typeid(LeaveRoom)) {
            handleLeaveRoom(std::any_cast<LeaveRoom>(msg));
        }
        else if (msg.type() == typeid(SetReady)) {
            handleSetReady(std::any_cast<SetReady>(msg));
        }
        else if (msg.type() == typeid(GameAction)) {
            handleGameAction(std::any_cast<GameAction>(msg));
        }
        else if (msg.type() == typeid(StartGame)) {
            handleStartGame();
        }
        else if (msg.type() == typeid(EndGame)) {
            handleEndGame(std::any_cast<EndGame>(msg));
        }
    }

private:
    void handleJoinRoom(const JoinRoom& m) {
        if (players_.size() >= static_cast<size_t>(maxPlayers_)) {
            std::cout << "[Room " << roomId_ << "] Room is full, rejecting " << m.playerName << "\n";
            return;
        }

        if (status_ != RoomStatus::Waiting) {
            std::cout << "[Room " << roomId_ << "] Game in progress, rejecting " << m.playerName << "\n";
            return;
        }

        PlayerInfo player{m.playerId, m.playerName, false, 0};
        players_[m.playerId] = player;

        auto playerActor = std::make_shared<PlayerActor>(m.playerId, m.playerName);
        playerActors_[m.playerId] = playerActor;

        std::cout << "[Room " << roomId_ << "] " << m.playerName
                  << " joined (" << players_.size() << "/" << maxPlayers_ << ")\n";

        broadcast(m.playerId, PlayerJoined{player});
    }

    void handleLeaveRoom(const LeaveRoom& m) {
        auto it = players_.find(m.playerId);
        if (it == players_.end()) return;

        std::string playerName = it->second.name;
        players_.erase(it);
        playerActors_.erase(m.playerId);

        std::cout << "[Room " << roomId_ << "] " << playerName
                  << " left (" << players_.size() << "/" << maxPlayers_ << ")\n";

        broadcast("", PlayerLeft{m.playerId});

        if (status_ == RoomStatus::Playing && players_.size() < static_cast<size_t>(minPlayers_)) {
            status_ = RoomStatus::Finished;
            std::cout << "[Room " << roomId_ << "] Not enough players, game ended\n";
            broadcast("", GameEnded{"", getScores()});
        }

        if (players_.empty()) {
            status_ = RoomStatus::Waiting;
            std::cout << "[Room " << roomId_ << "] Room is empty, resetting\n";
        }
    }

    void handleSetReady(const SetReady& m) {
        auto it = players_.find(m.playerId);
        if (it == players_.end() || status_ != RoomStatus::Waiting) return;

        it->second.isReady = m.ready;
        std::cout << "[Room " << roomId_ << "] " << it->second.name
                  << " is " << (m.ready ? "ready" : "not ready") << "\n";

        broadcast("", PlayerReadyChanged{m.playerId, m.ready});
        checkStartCondition();
    }

    void handleGameAction(const GameAction& m) {
        if (status_ != RoomStatus::Playing) return;

        auto it = players_.find(m.playerId);
        if (it == players_.end()) return;

        std::cout << "[Room " << roomId_ << "] " << it->second.name
                  << " action: " << m.actionType << "\n";

        if (m.actionType == "SCORE") {
            it->second.score += m.points;
            std::cout << "[Room " << roomId_ << "] " << it->second.name
                      << " score: " << it->second.score << "\n";
        }

        broadcast("", GameActionBroadcast{m.playerId, m.actionType, m.points});
    }

    void handleStartGame() {
        if (status_ != RoomStatus::Waiting) return;

        status_ = RoomStatus::Starting;
        std::cout << "[Room " << roomId_ << "] Game starting...\n";

        std::thread([this]() {
            for (int countdown = 3; countdown > 0; countdown--) {
                {
                    std::lock_guard<std::mutex> lock(mutex_);
                    broadcast("", GameStarting{countdown});
                }
                std::cout << "[Room " << roomId_ << "] Starting in " << countdown << "...\n";
                std::this_thread::sleep_for(std::chrono::seconds(1));
            }

            {
                std::lock_guard<std::mutex> lock(mutex_);
                status_ = RoomStatus::Playing;
                std::cout << "[Room " << roomId_ << "] Game started!\n";
                broadcast("", GameStarted{});
            }
        }).detach();
    }

    void handleEndGame(const EndGame& m) {
        if (status_ != RoomStatus::Playing) return;

        status_ = RoomStatus::Finished;
        std::string winner = m.winnerId.empty() ? "none" : m.winnerId;
        std::cout << "[Room " << roomId_ << "] Game ended! Winner: " << winner << "\n";

        broadcast("", GameEnded{m.winnerId, getScores()});

        std::thread([this]() {
            std::this_thread::sleep_for(std::chrono::seconds(5));
            std::lock_guard<std::mutex> lock(mutex_);
            status_ = RoomStatus::Waiting;
            for (auto& [_, player] : players_) {
                player.isReady = false;
                player.score = 0;
            }
            std::cout << "[Room " << roomId_ << "] Room reset to waiting\n";
        }).detach();
    }

    template<typename T>
    void broadcast(const std::string& excludeId, const T& msg) {
        for (const auto& [id, actor] : playerActors_) {
            if (id != excludeId) {
                actor->receive(msg);
            }
        }
    }

    void checkStartCondition() {
        if (players_.size() >= static_cast<size_t>(minPlayers_)) {
            bool allReady = true;
            for (const auto& [_, player] : players_) {
                if (!player.isReady) {
                    allReady = false;
                    break;
                }
            }
            if (allReady) {
                std::cout << "[Room " << roomId_ << "] All players ready!\n";
                handleStartGame();
            }
        }
    }

    std::map<std::string, int> getScores() const {
        std::map<std::string, int> scores;
        for (const auto& [id, player] : players_) {
            scores[id] = player.score;
        }
        return scores;
    }

    std::string roomId_;
    RoomStatus status_;
    std::map<std::string, PlayerInfo> players_;
    std::map<std::string, std::shared_ptr<PlayerActor>> playerActors_;
    int maxPlayers_;
    int minPlayers_;
    std::mutex mutex_;
};

// ============================================
// 메인 함수
// ============================================

int main() {
    std::cout << "=== Game Room Actor Pattern Demo (C++) ===\n\n";

    RoomActor room("001");

    std::cout << "--- 1. Players Joining ---\n\n";

    room.receive(JoinRoom{"p1", "Alice"});
    std::this_thread::sleep_for(std::chrono::milliseconds(100));

    room.receive(JoinRoom{"p2", "Bob"});
    std::this_thread::sleep_for(std::chrono::milliseconds(100));

    room.receive(JoinRoom{"p3", "Charlie"});
    std::this_thread::sleep_for(std::chrono::milliseconds(100));

    std::cout << "\n--- 2. Players Getting Ready ---\n\n";

    room.receive(SetReady{"p1", true});
    std::this_thread::sleep_for(std::chrono::milliseconds(100));

    room.receive(SetReady{"p2", true});
    std::this_thread::sleep_for(std::chrono::milliseconds(100));

    // 마지막 플레이어가 준비되면 게임 시작
    room.receive(SetReady{"p3", true});

    // 게임 시작 대기
    std::this_thread::sleep_for(std::chrono::seconds(5));

    std::cout << "\n--- 3. Game Actions ---\n\n";

    room.receive(GameAction{"p1", "SCORE", 10});
    std::this_thread::sleep_for(std::chrono::milliseconds(100));

    room.receive(GameAction{"p2", "SCORE", 15});
    std::this_thread::sleep_for(std::chrono::milliseconds(100));

    room.receive(GameAction{"p1", "SCORE", 20});
    std::this_thread::sleep_for(std::chrono::milliseconds(100));

    std::cout << "\n--- 4. Game End ---\n\n";

    room.receive(EndGame{"p1"});
    std::this_thread::sleep_for(std::chrono::seconds(1));

    std::cout << "\n--- 5. Player Leaving ---\n\n";

    room.receive(LeaveRoom{"p3"});
    std::this_thread::sleep_for(std::chrono::milliseconds(100));

    std::cout << "\n=== Demo Complete ===\n";

    return 0;
}
