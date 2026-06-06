cmake_minimum_required(VERSION 3.8)
project(decision_executor)

if(CMAKE_COMPILER_IS_GNUCXX OR CMAKE_CXX_COMPILER_ID MATCHES "Clang")
  add_compile_options(-Wall -Wextra -Wpedantic)
endif()

# Find dependencies
find_package(ament_cmake REQUIRED)
find_package(rclcpp REQUIRED)
find_package(rclcpp_action REQUIRED)
find_package(sentry_msgs REQUIRED)
find_package(nav2_msgs REQUIRED)
find_package(geometry_msgs REQUIRED)
find_package(yaml-cpp REQUIRED)
find_package(rosidl_typesupport_introspection_cpp REQUIRED)
find_package(rosidl_runtime_cpp REQUIRED)

# Include directories
include_directories(
  include
  ${YAML_CPP_INCLUDE_DIRS}
)

# Decision Executor executable
add_executable(decision_executor
  src/DecisionExecutor.cpp
  src/DecisionNode.cpp
  src/FieldMapper.cpp
)

ament_target_dependencies(decision_executor
  rclcpp
  rclcpp_action
  sentry_msgs
  nav2_msgs
  geometry_msgs
  rosidl_typesupport_introspection_cpp
  rosidl_runtime_cpp
)

target_link_libraries(decision_executor
  ${YAML_CPP_LIBRARIES}
)

# Install targets
install(TARGETS
  decision_executor
  DESTINATION lib/${PROJECT_NAME}
)

# Install launch files and config
install(DIRECTORY
  launch
  config
  DESTINATION share/${PROJECT_NAME}
)

if(BUILD_TESTING)
  find_package(ament_lint_auto REQUIRED)
  ament_lint_auto_find_test_dependencies()
endif()

ament_package()
