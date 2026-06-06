#include "decision_executor/FieldMapper.hpp"
#include <algorithm>
#include <stdexcept>
#include <rosidl_typesupport_introspection_cpp/message_introspection.hpp>
#include <rosidl_typesupport_introspection_cpp/field_types.hpp>
#include <rosidl_typesupport_introspection_cpp/message_type_support_decl.hpp>
#include <sentry_msgs/msg/detail/referee__rosidl_typesupport_introspection_cpp.hpp>
#include <iostream>

namespace decision_executor
{

FieldMapper::FieldMapper()
{
}

const rosidl_typesupport_introspection_cpp::MessageMembers* getMessageMembers()
{
  const rosidl_message_type_support_t* ts = rosidl_typesupport_introspection_cpp::get_message_type_support_handle<sentry_msgs::msg::Referee>();
  if (!ts) {
    throw std::runtime_error("Failed to get type support handle for sentry_msgs::msg::Referee");
  }
  return static_cast<const rosidl_typesupport_introspection_cpp::MessageMembers*>(ts->data);
}

const rosidl_typesupport_introspection_cpp::MessageMember* getMember(const std::string& field_name)
{
  const auto* members = getMessageMembers();
  for (uint32_t i = 0; i < members->member_count_; ++i) {
    const auto& member = members->members_[i];
    if (member.name_ == field_name) {
      return &member;
    }
  }
  return nullptr;
}

double FieldMapper::getValue(const std::string& field_name, const sentry_msgs::msg::Referee& msg) const
{
  using namespace rosidl_typesupport_introspection_cpp;

  const auto* member = getMember(field_name);
  if (!member) {
    throw std::runtime_error("Unknown field: " + field_name);
  }

  const uint8_t* msg_ptr = reinterpret_cast<const uint8_t*>(&msg);
  const uint8_t* field_ptr = msg_ptr + member->offset_;

  switch (member->type_id_) {
    case rosidl_typesupport_introspection_cpp::ROS_TYPE_FLOAT:
      return static_cast<double>(*reinterpret_cast<const float*>(field_ptr));
    case rosidl_typesupport_introspection_cpp::ROS_TYPE_DOUBLE:
      return *reinterpret_cast<const double*>(field_ptr);
    case rosidl_typesupport_introspection_cpp::ROS_TYPE_LONG_DOUBLE:
      return static_cast<double>(*reinterpret_cast<const long double*>(field_ptr));
    case rosidl_typesupport_introspection_cpp::ROS_TYPE_CHAR:
      return static_cast<double>(*reinterpret_cast<const char*>(field_ptr));
    case rosidl_typesupport_introspection_cpp::ROS_TYPE_WCHAR:
      return static_cast<double>(*reinterpret_cast<const wchar_t*>(field_ptr));
    case rosidl_typesupport_introspection_cpp::ROS_TYPE_BOOLEAN:
      return static_cast<double>(*reinterpret_cast<const bool*>(field_ptr));
    case rosidl_typesupport_introspection_cpp::ROS_TYPE_OCTET:
    case rosidl_typesupport_introspection_cpp::ROS_TYPE_UINT8:
      return static_cast<double>(*reinterpret_cast<const uint8_t*>(field_ptr));
    case rosidl_typesupport_introspection_cpp::ROS_TYPE_INT8:
      return static_cast<double>(*reinterpret_cast<const int8_t*>(field_ptr));
    case rosidl_typesupport_introspection_cpp::ROS_TYPE_UINT16:
      return static_cast<double>(*reinterpret_cast<const uint16_t*>(field_ptr));
    case rosidl_typesupport_introspection_cpp::ROS_TYPE_INT16:
      return static_cast<double>(*reinterpret_cast<const int16_t*>(field_ptr));
    case rosidl_typesupport_introspection_cpp::ROS_TYPE_UINT32:
      return static_cast<double>(*reinterpret_cast<const uint32_t*>(field_ptr));
    case rosidl_typesupport_introspection_cpp::ROS_TYPE_INT32:
      return static_cast<double>(*reinterpret_cast<const int32_t*>(field_ptr));
    case rosidl_typesupport_introspection_cpp::ROS_TYPE_UINT64:
      return static_cast<double>(*reinterpret_cast<const uint64_t*>(field_ptr));
    case rosidl_typesupport_introspection_cpp::ROS_TYPE_INT64:
      return static_cast<double>(*reinterpret_cast<const int64_t*>(field_ptr));
    default:
      throw std::runtime_error("Unsupported field type for field: " + field_name);
  }
}

bool FieldMapper::hasField(const std::string& field_name) const
{
  return getMember(field_name) != nullptr;
}

std::vector<std::string> FieldMapper::getFieldNames() const
{
  std::vector<std::string> names;
  const auto* members = getMessageMembers();
  names.reserve(members->member_count_);
  for (uint32_t i = 0; i < members->member_count_; ++i) {
    names.push_back(members->members_[i].name_);
  }
  return names;
}

} // namespace decision_executor
