cmake_minimum_required(VERSION 3.8)
project(serial_interfaces)

# 设置 C++ 标准
# if(NOT CMAKE_CXX_STANDARD)
#   set(CMAKE_CXX_STANDARD 17)
# endif()

# if(CMAKE_COMPILER_IS_GNUCXX OR CMAKE_CXX_COMPILER_ID MATCHES "Clang")
#   add_compile_options(-Wall -Wextra -Wpedantic)
# endif()

# 1. 查找依赖包
find_package(ament_cmake REQUIRED)
find_package(rclcpp REQUIRED)
find_package(geometry_msgs REQUIRED)
find_package(sentry_msgs REQUIRED)  # 自定义消息包
find_package(Boost REQUIRED COMPONENTS system thread) # 串口需要的库

# 2. 添加头文件路径
include_directories(
  include
  ${Boost_INCLUDE_DIRS}
)

# 3. 生成可执行文件
add_executable(serial_interfaces 
  src/serial_interfaces.cpp
)

# 4. 指定链接依赖
target_link_libraries(serial_interfaces
  ${Boost_LIBRARIES}
)

# 5. ament 依赖处理 (自动处理头文件和库路径)
ament_target_dependencies(serial_interfaces
  rclcpp
  geometry_msgs
  sentry_msgs
)

# 6. 安装规则 (为了让 ros2 run 能找到节点)
install(TARGETS serial_interfaces
  DESTINATION lib/${PROJECT_NAME}
)

# 安装头文件 (可选，如果其他包需要引用此包)
install(DIRECTORY include/
  DESTINATION include
)

# 安装 launch 文件 (为了让 ros2 launch 能找到)
install(DIRECTORY launch
  DESTINATION share/${PROJECT_NAME}
)

if(BUILD_TESTING)
  find_package(ament_lint_auto REQUIRED)
  set(ament_cmake_copyright_FOUND TRUE)
  set(ament_cmake_cpplint_FOUND TRUE)
  ament_lint_auto_find_test_dependencies()
endif()

ament_package()