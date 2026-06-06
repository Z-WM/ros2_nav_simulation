cmake_minimum_required(VERSION 3.8)
project(nav2_waypoint_panel)

if(CMAKE_COMPILER_IS_GNUCXX OR CMAKE_CXX_COMPILER_ID MATCHES "Clang")
  add_compile_options(-Wall -Wextra -Wpedantic)
endif()

# finds
find_package(ament_cmake REQUIRED)
find_package(rviz_common REQUIRED)
find_package(rviz_default_plugins REQUIRED)
find_package(rclcpp REQUIRED)
find_package(rclcpp_action REQUIRED)
find_package(nav2_msgs REQUIRED)
find_package(nav2_lifecycle_manager REQUIRED)
find_package(geometry_msgs REQUIRED)
find_package(visualization_msgs REQUIRED)
find_package(pluginlib REQUIRED)
find_package(tf2 REQUIRED)
find_package(tf2_geometry_msgs REQUIRED)
find_package(Qt5 REQUIRED COMPONENTS Core Gui Widgets)

# Qt setup
set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)
set(CMAKE_AUTOUIC ON)

include_directories(include)

# Specifically list headers with Q_OBJECT to ensure MOC runs
set(MOC_HEADERS
  include/nav2_waypoint_panel/waypoint_panel.hpp
  include/nav2_waypoint_panel/waypoint_tool.hpp
)

add_library(${PROJECT_NAME} SHARED
  src/waypoint_panel.cpp
  src/waypoint_tool.cpp
  ${MOC_HEADERS}
)

# Use ament_target_dependencies for ROS2 packages
ament_target_dependencies(${PROJECT_NAME}
  rviz_common
  rviz_default_plugins
  rclcpp
  rclcpp_action
  nav2_msgs
  nav2_lifecycle_manager
  geometry_msgs
  visualization_msgs
  pluginlib
  tf2
  tf2_geometry_msgs
)

# Link against Qt
target_link_libraries(${PROJECT_NAME}
  Qt5::Core
  Qt5::Gui
  Qt5::Widgets
)

# Export plugin
pluginlib_export_plugin_description_file(rviz_common plugin_description.xml)

install(TARGETS ${PROJECT_NAME}
  EXPORT export_${PROJECT_NAME}
  ARCHIVE DESTINATION lib
  LIBRARY DESTINATION lib
  RUNTIME DESTINATION bin
)

install(FILES plugin_description.xml
  DESTINATION share/${PROJECT_NAME}
)

install(DIRECTORY include/
  DESTINATION include
)

ament_export_libraries(${PROJECT_NAME})
ament_export_targets(export_${PROJECT_NAME})
ament_package()
