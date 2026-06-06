#include "decision_executor/DecisionNode.hpp"
#include <cmath>
#include <stdexcept>

namespace decision_executor
{

// ======== ConditionNode Implementation ========

ConditionNode::ConditionNode(
  const std::string& field,
  const std::string& op,
  double threshold,
  std::shared_ptr<FieldMapper> mapper
) : field_(field), operator_(op), threshold_(threshold), field_mapper_(mapper)
{
  if (!field_mapper_->hasField(field)) {
    throw std::runtime_error("Invalid field: " + field);
  }
}

NodeStatus ConditionNode::tick(const sentry_msgs::msg::Referee& msg)
{
  double field_value = field_mapper_->getValue(field_, msg);
  return evaluateCondition(field_value) ? NodeStatus::SUCCESS : NodeStatus::FAILURE;
}

bool ConditionNode::evaluateCondition(double field_value) const
{
  if (operator_ == ">") {
    return field_value > threshold_;
  } else if (operator_ == "<") {
    return field_value < threshold_;
  } else if (operator_ == "==") {
    return field_value == threshold_;
  } else if (operator_ == "!=") {
    return field_value != threshold_;
  } else if (operator_ == ">=") {
    return field_value >= threshold_;
  } else if (operator_ == "<=") {
    return field_value <= threshold_;
  } else {
    throw std::runtime_error("Unknown operator: " + operator_);
  }
}

// ======== ActionNode Implementation ========

ActionNode::ActionNode(const std::string& action, double duration)
  : actions_({action}), loop_(false), duration_(duration)
{
}

ActionNode::ActionNode(const std::vector<std::string>& actions, bool loop, double duration)
  : actions_(actions), loop_(loop), duration_(duration)
{
}

NodeStatus ActionNode::tick(const sentry_msgs::msg::Referee& msg)
{
  (void)msg;
  return NodeStatus::SUCCESS;
}

void ActionNode::setExitCondition(const std::string& field, const std::string& op,
                                   double threshold, std::shared_ptr<FieldMapper> mapper)
{
  exit_condition_ = ExitCondition{field, op, threshold, mapper};
}

bool ActionNode::checkExitCondition(const sentry_msgs::msg::Referee& msg) const
{
  if (!exit_condition_.has_value()) return true;  // No exit condition = always free

  const auto& ec = exit_condition_.value();
  double value = ec.field_mapper->getValue(ec.field, msg);

  if (ec.op == ">")  return value > ec.threshold;
  if (ec.op == "<")  return value < ec.threshold;
  if (ec.op == ">=") return value >= ec.threshold;
  if (ec.op == "<=") return value <= ec.threshold;
  if (ec.op == "==") return std::abs(value - ec.threshold) < 1e-6;
  if (ec.op == "!=") return std::abs(value - ec.threshold) >= 1e-6;
  return true;
}
// ======== SelectorNode Implementation ========

void SelectorNode::addChild(std::shared_ptr<DecisionNode> child)
{
  children_.push_back(child);
  
  // Sort children by priority (asc)
  // Low priority value means high execution priority
  std::stable_sort(children_.begin(), children_.end(), 
    [](const std::shared_ptr<DecisionNode>& a, const std::shared_ptr<DecisionNode>& b) {
      return a->getPriority() < b->getPriority();
    });
}

NodeStatus SelectorNode::tick(const sentry_msgs::msg::Referee& msg)
{
  // Return SUCCESS on first successful child (OR logic)
  for (auto& child : children_) {
    NodeStatus status = child->tick(msg);
    if (status == NodeStatus::SUCCESS) {
      return NodeStatus::SUCCESS;
    }
  }
  return NodeStatus::FAILURE;
}

// ======== SequenceNode Implementation ========

void SequenceNode::addChild(std::shared_ptr<DecisionNode> child)
{
  children_.push_back(child);
}

NodeStatus SequenceNode::tick(const sentry_msgs::msg::Referee& msg)
{
  // Return SUCCESS only if ALL children succeed (AND logic)
  for (auto& child : children_) {
    NodeStatus status = child->tick(msg);
    if (status != NodeStatus::SUCCESS) {
      return NodeStatus::FAILURE;
    }
  }
  return NodeStatus::SUCCESS;
}

} // namespace decision_executor
