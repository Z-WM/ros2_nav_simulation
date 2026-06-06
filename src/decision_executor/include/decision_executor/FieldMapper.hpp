#ifndef DECISION_EXECUTOR__FIELD_MAPPER_HPP_
#define DECISION_EXECUTOR__FIELD_MAPPER_HPP_

#include <functional>
#include <map>
#include <string>
#include <stdexcept>
#include "sentry_msgs/msg/referee.hpp"

namespace decision_executor
{

/**
 * @brief FieldMapper solves the C++ reflection problem by mapping string field names
 * to actual message member accessors using std::function and std::map.
 * 
 * This allows YAML-defined field names like "own_robot_hp" to directly access
 * msg->own_robot_hp without if-else chains.
 */
class FieldMapper
{
public:
  using Referee = sentry_msgs::msg::Referee;
  using FieldAccessor = std::function<double(const Referee&)>;

  FieldMapper();

  /**
   * @brief Get the value of a field by its string name
   * @param field_name String name of the field (e.g., "own_robot_hp")
   * @param msg The Referee message to extract from
   * @return The field value as a double
   * @throws std::runtime_error if field name is not found
   */
  double getValue(const std::string& field_name, const Referee& msg) const;

  /**
   * @brief Check if a field name is valid
   */
  bool hasField(const std::string& field_name) const;

  /**
   * @brief Get list of all valid field names
   */
  std::vector<std::string> getFieldNames() const;

private:
  std::map<std::string, FieldAccessor> field_accessors_;

  void registerFields();
};

} // namespace decision_executor

#endif // DECISION_EXECUTOR__FIELD_MAPPER_HPP_
