cmake_minimum_required(VERSION 3.16)
project(lio_relocalization VERSION 1.0 LANGUAGES CXX)

# 使用 C++17 标准(不使用编译器扩展)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# 默认 Release 构建;-O3 优化、多线程、支持异常处理(PCL 需要异常)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()
set(CMAKE_CXX_FLAGS_RELEASE "-O3 -pthread -fexceptions")

# 依赖:ROS2 核心、消息类型、TF2、PCL、Eigen
find_package(ament_cmake REQUIRED)
find_package(rclcpp REQUIRED)
find_package(ament_index_cpp REQUIRED)
find_package(sensor_msgs REQUIRED)
find_package(nav_msgs REQUIRED)
find_package(geometry_msgs REQUIRED)
find_package(tf2_ros REQUIRED)
find_package(tf2_geometry_msgs REQUIRED)
find_package(pcl_ros REQUIRED)
find_package(pcl_conversions REQUIRED)
find_package(Eigen3 REQUIRED NO_MODULE)
find_package(PCL REQUIRED)

# PCL 需要预编译头关闭,以支持自定义点类型 PointXYZI
add_definitions(-DPCL_NO_PRECOMPILE)

# 可执行目标
add_executable(relocalization_node
  src/relocalization_node.cpp
)

target_include_directories(relocalization_node PRIVATE
  ${EIGEN3_INCLUDE_DIRS}
  ${PCL_INCLUDE_DIRS}
)

ament_target_dependencies(relocalization_node
  rclcpp
  ament_index_cpp
  sensor_msgs
  nav_msgs
  geometry_msgs
  tf2_ros
  tf2_geometry_msgs
  pcl_ros
  pcl_conversions
)

target_link_libraries(relocalization_node
  ${PCL_LIBRARIES}
  Eigen3::Eigen
)

# 安装可执行文件到 lib/<package>/
install(TARGETS relocalization_node
  DESTINATION lib/${PROJECT_NAME}
)

# 安装 launch / config / rviz / map 资源到 share 目录,供运行时读取
install(DIRECTORY launch/
  DESTINATION share/${PROJECT_NAME}/launch
)
install(DIRECTORY config/
  DESTINATION share/${PROJECT_NAME}/config
)
install(DIRECTORY rviz/
  DESTINATION share/${PROJECT_NAME}/rviz
)
install(DIRECTORY map/
  DESTINATION share/${PROJECT_NAME}/map
)

ament_package()
