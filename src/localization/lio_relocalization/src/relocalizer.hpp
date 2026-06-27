#ifndef LIO_RELOCALIZATION__RELOCALIZER_HPP_
#define LIO_RELOCALIZATION__RELOCALIZER_HPP_

#include <deque>
#include <memory>
#include <string>

#include <Eigen/Core>
#include <Eigen/Geometry>
#include <Eigen/StdVector>

#include <pcl/point_types.h>
#include <pcl/point_cloud.h>
#include <pcl/registration/ndt.h>
#include <pcl/registration/icp.h>
#include <pcl/filters/voxel_grid.h>

#include <rclcpp/rclcpp.hpp>
#include <tf2_ros/transform_broadcaster.h>
#include <builtin_interfaces/msg/time.hpp>
#include <geometry_msgs/msg/pose_stamped.hpp>
#include <geometry_msgs/msg/pose_with_covariance_stamped.hpp>
#include <geometry_msgs/msg/transform_stamped.hpp>
#include <nav_msgs/msg/odometry.hpp>
#include <sensor_msgs/msg/imu.hpp>
#include <sensor_msgs/msg/point_cloud2.hpp>
#include <pcl_conversions/pcl_conversions.h>

namespace lio_relocalization {

// 点云/地图数据类型别名:PointXYZI 含强度
using PointT = pcl::PointXYZI;
using CloudT = pcl::PointCloud<PointT>;
using CloudPtr = CloudT::Ptr;

class Relocalizer : public rclcpp::Node {
 public:
  // 节点状态机:等待位姿 -> 配准对齐 -> 跟踪广播
  enum class State {
    // 等待初始位姿猜测(来自 /initialpose 或默认参数)。
    kWaitPose,
    // 累积激光帧 + IMU 样本,然后执行 NDT+ICP。
    kAligning,
    // 配准成功:持续广播 map->odom TF。
    kTracking,
  };

  Relocalizer();
  ~Relocalizer() override = default;

 private:
  // ---- 参数 ----
  std::string map_path_;            // PCD 地图路径
  std::string map_frame_;           // 地图坐标系(map)
  std::string odom_frame_;          // 里程计坐标系(odom)
  std::string lidar_topic_;         // 输入激光点云话题
  std::string imu_topic_;           // 输入 IMU 话题
  std::string odom_topic_;          // 外部 LIO 里程计话题
  std::string pose_topic_;          // 输出位姿话题
  std::string global_map_topic_;    // 输出全局地图话题
  bool publish_global_map_{true};   // 是否发布全局地图

  Eigen::Vector3d init_pose_t_{Eigen::Vector3d::Zero()};   // 初始位姿平移
  Eigen::Matrix3d init_pose_R_{Eigen::Matrix3d::Identity()};  // 初始位姿旋转
  double gravity_norm_{9.7946};      // 重力模长(用于对齐初始猜测)
  double voxel_leaf_size_{0.5};      // 输入扫描体素降采样边长
  int need_init_frames_{10};         // 配准前需累积的激光帧数
  int need_imu_samples_{20};         // 配准前需累积的 IMU 样本数

  // NDT 参数
  double ndt_resolution_{1.0};                 // NDT 网格分辨率
  double ndt_transformation_epsilon_{1e-4};   // 变换收敛阈值
  double ndt_fitness_epsilon_{1e-4};          // 适应度收敛阈值
  int ndt_max_iterations_{25};                // 最大迭代次数
  // ICP 参数
  double icp_max_correspondence_distance_{4.0};  // 最大对应点距离
  int icp_max_iterations_{40};                    // 最大迭代次数
  double icp_transformation_epsilon_{1e-4};       // 变换收敛阈值
  double icp_fitness_epsilon_{1e-4};              // 适应度收敛阈值
  int icp_ransac_iterations_{0};                  // RANSAC 迭代次数(0=禁用)
  double fitness_threshold_{1.5};                 // 收敛判定门限

  double tf_publish_period_{0.05};  // 跟踪期 map->odom TF 广播周期(秒)

  // ---- 状态 ----
  State state_{State::kWaitPose};
  bool got_init_pose_{false};        // 已收到新的 /initialpose(或使用默认值)
  bool has_odom_{false};             // 已收到最新外部里程计
  Eigen::Isometry3d latest_odom_pose_{Eigen::Isometry3d::Identity()};  // T_odom_base
  // 最近一次 /lio/odom 的仿真时钟时间戳;map->odom TF 用该时间戳打标,
  // 使修正量与 Nav2 变换所用的里程计数据对齐(避免 use_sim_time 下出现
  // "extrapolation into the past" 查找失败)。
  builtin_interfaces::msg::Time latest_odom_stamp_{};

  // 地图(NDT/ICP 的目标点云)
  CloudPtr map_cloud_;
  bool map_loaded_{false};

  // 配准用的累积源点云 + IMU 统计量
  CloudPtr acc_cloud_;
  int acc_frame_count_{0};
  int imu_count_{0};
  Eigen::Vector3d mean_acce_{Eigen::Vector3d::Zero()};  // 加速度均值

  // map->odom 修正量(p_map = T_map_odom_ * p_odom),配准成功时设置
  bool has_correction_{false};
  Eigen::Isometry3d T_map_odom_{Eigen::Isometry3d::Identity()};
  Eigen::Isometry3d aligned_pose_{Eigen::Isometry3d::Identity()};  // 地图中的结果位姿

  // ---- ROS 输入输出 ----
  rclcpp::Subscription<sensor_msgs::msg::PointCloud2>::SharedPtr sub_cloud_;
  rclcpp::Subscription<sensor_msgs::msg::Imu>::SharedPtr sub_imu_;
  rclcpp::Subscription<nav_msgs::msg::Odometry>::SharedPtr sub_odom_;
  rclcpp::Subscription<geometry_msgs::msg::PoseWithCovarianceStamped>::SharedPtr
      sub_initialpose_;
  rclcpp::Publisher<geometry_msgs::msg::PoseStamped>::SharedPtr pub_pose_;
  rclcpp::Publisher<sensor_msgs::msg::PointCloud2>::SharedPtr pub_global_map_;
  std::shared_ptr<tf2_ros::TransformBroadcaster> tf_broadcaster_;
  rclcpp::TimerBase::SharedPtr global_map_timer_;  // 全局地图发布定时器
  rclcpp::TimerBase::SharedPtr tf_timer_;          // TF 广播定时器
  sensor_msgs::msg::PointCloud2 global_map_msg_;   // 预序列化的全局地图消息

  // ---- 回调 ----
  void onCloud(const sensor_msgs::msg::PointCloud2::SharedPtr msg);
  void onImu(const sensor_msgs::msg::Imu::SharedPtr msg);
  void onOdom(const nav_msgs::msg::Odometry::SharedPtr msg);
  void onInitialPose(
      const geometry_msgs::msg::PoseWithCovarianceStamped::SharedPtr msg);

  // ---- 辅助函数 ----
  void loadMap();
  bool tryAlign();          // NDT+ICP;成功则设置 T_map_odom_ 与 aligned_pose_
  void resetAlignment();    // 清空累积量并回到 kWaitPose
  void enterTracking();     // 发布位姿、启动 TF 定时器、释放 /initialpose 订阅
  void publishPose();
  void publishGlobalMap();
  void broadcastTf();
  void setupGlobalMapPublisher();
};

}  // namespace lio_relocalization

#endif  // LIO_RELOCALIZATION__RELOCALIZER_HPP_
