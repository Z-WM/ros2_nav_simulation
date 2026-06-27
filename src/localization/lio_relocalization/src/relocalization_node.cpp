#include "relocalizer.hpp"

#include <chrono>
#include <cmath>
#include <sstream>

#include <ament_index_cpp/get_package_share_directory.hpp>
#include <pcl/common/transforms.h>
#include <pcl/io/pcd_io.h>
#include <pcl/filters/filter.h>
#include <pcl/filters/voxel_grid.h>

namespace lio_relocalization {

// 终端彩色输出,用于日志区分不同阶段
static const char* kColorRed = "\033[31m";
static const char* kColorGreen = "\033[32m";
static const char* kColorYellow = "\033[33m";
static const char* kColorReset = "\033[0m";

Relocalizer::Relocalizer() : rclcpp::Node("relocalization_node") {
  // ---- 声明 / 加载参数 ----
  map_path_ = this->declare_parameter<std::string>(
      "relocalization.map_path", "");
  map_frame_ = this->declare_parameter<std::string>(
      "relocalization.map_frame", "map");
  odom_frame_ = this->declare_parameter<std::string>(
      "relocalization.odom_frame", "odom");
  lidar_topic_ = this->declare_parameter<std::string>(
      "relocalization.lidar_topic", "/livox/lidar/pointcloud");
  imu_topic_ = this->declare_parameter<std::string>(
      "relocalization.imu_topic", "/livox/imu");
  odom_topic_ = this->declare_parameter<std::string>(
      "relocalization.odom_topic", "/lio/odom");
  pose_topic_ = this->declare_parameter<std::string>(
      "relocalization.pose_topic", "/relocalization/pose");
  global_map_topic_ = this->declare_parameter<std::string>(
      "relocalization.global_map_topic", "/relocalization/global_map");
  publish_global_map_ = this->declare_parameter<bool>(
      "relocalization.publish_global_map", true);

  // 默认初始位姿 [x, y, z, roll(deg), pitch(deg), yaw(deg)]
  // 注意旋转按 ZYX(即 yaw-pitch-roll)顺序构造,角度需转弧度。
  std::vector<double> init_pose = this->declare_parameter<std::vector<double>>(
      "relocalization.init_pose", std::vector<double>(6, 0.0));
  init_pose_t_ = Eigen::Vector3d(init_pose[0], init_pose[1], init_pose[2]);
  init_pose_R_ =
      (Eigen::AngleAxisd(init_pose[5] * M_PI / 180.0, Eigen::Vector3d::UnitZ()) *
       Eigen::AngleAxisd(init_pose[4] * M_PI / 180.0, Eigen::Vector3d::UnitY()) *
       Eigen::AngleAxisd(init_pose[3] * M_PI / 180.0, Eigen::Vector3d::UnitX()))
          .toRotationMatrix();

  gravity_norm_ = this->declare_parameter<double>(
      "relocalization.gravity_norm", 9.7946);
  voxel_leaf_size_ = this->declare_parameter<double>(
      "relocalization.voxel_leaf_size", 0.5);
  need_init_frames_ = this->declare_parameter<int>(
      "relocalization.need_init_frames", 10);
  need_imu_samples_ = this->declare_parameter<int>(
      "relocalization.need_imu_samples", 20);

  // NDT 参数
  ndt_resolution_ = this->declare_parameter<double>(
      "relocalization.ndt_resolution", 1.0);
  ndt_transformation_epsilon_ = this->declare_parameter<double>(
      "relocalization.ndt_transformation_epsilon", 1e-4);
  ndt_fitness_epsilon_ = this->declare_parameter<double>(
      "relocalization.ndt_fitness_epsilon", 1e-4);
  ndt_max_iterations_ = this->declare_parameter<int>(
      "relocalization.ndt_max_iterations", 25);
  // ICP 参数
  icp_max_correspondence_distance_ = this->declare_parameter<double>(
      "relocalization.icp_max_correspondence_distance", 4.0);
  icp_max_iterations_ = this->declare_parameter<int>(
      "relocalization.icp_max_iterations", 40);
  icp_transformation_epsilon_ = this->declare_parameter<double>(
      "relocalization.icp_transformation_epsilon", 1e-4);
  icp_fitness_epsilon_ = this->declare_parameter<double>(
      "relocalization.icp_fitness_epsilon", 1e-4);
  icp_ransac_iterations_ = this->declare_parameter<int>(
      "relocalization.icp_ransac_iterations", 0);
  fitness_threshold_ = this->declare_parameter<double>(
      "relocalization.fitness_threshold", 1.5);
  tf_publish_period_ = this->declare_parameter<double>(
      "relocalization.tf_publish_period", 0.05);

  RCLCPP_INFO(this->get_logger(),
              "%s ---> [relocalization]: lidar_topic=%s odom_topic=%s map_path=%s%s",
              kColorGreen, lidar_topic_.c_str(), odom_topic_.c_str(),
              map_path_.empty() ? "(default share map)" : map_path_.c_str(),
              kColorReset);

  // ---- 分配点云内存 ----
  map_cloud_.reset(new CloudT());
  acc_cloud_.reset(new CloudT());

  // ---- 加载地图(NDT/ICP 的目标点云) ----
  loadMap();

  // ---- 发布者 / 订阅者 ----
  pub_pose_ = this->create_publisher<geometry_msgs::msg::PoseStamped>(
      pose_topic_, 10);
  if (publish_global_map_) {
    pub_global_map_ = this->create_publisher<sensor_msgs::msg::PointCloud2>(
        global_map_topic_, 10);
    setupGlobalMapPublisher();
  }

  tf_broadcaster_ = std::make_shared<tf2_ros::TransformBroadcaster>(this);

  // 使用独立的传感器回调组,使繁重的配准工作不会阻塞 spin。
  rclcpp::CallbackGroup::SharedPtr cb_sensor =
      this->create_callback_group(rclcpp::CallbackGroupType::MutuallyExclusive);
  rclcpp::SubscriptionOptions sub_opts;
  sub_opts.callback_group = cb_sensor;

  // 传感器话题用 best_effort QoS(与 LIO/雷达发布端一致)
  auto qos = rclcpp::QoS(rclcpp::KeepLast(10)).best_effort();
  sub_cloud_ = this->create_subscription<sensor_msgs::msg::PointCloud2>(
      lidar_topic_, qos,
      std::bind(&Relocalizer::onCloud, this, std::placeholders::_1), sub_opts);
  sub_imu_ = this->create_subscription<sensor_msgs::msg::Imu>(
      imu_topic_, qos,
      std::bind(&Relocalizer::onImu, this, std::placeholders::_1), sub_opts);
  sub_odom_ = this->create_subscription<nav_msgs::msg::Odometry>(
      odom_topic_, qos,
      std::bind(&Relocalizer::onOdom, this, std::placeholders::_1), sub_opts);
  // /initialpose 走可靠传输(RViz 以 reliable 方式发送),用默认回调组。
  sub_initialpose_ = this->create_subscription<
      geometry_msgs::msg::PoseWithCovarianceStamped>(
      "/initialpose", 1,
      std::bind(&Relocalizer::onInitialPose, this, std::placeholders::_1));

  RCLCPP_INFO(this->get_logger(), "%s ---> [relocalization]: ready. "
              "Publish an initial pose in RViz (or set init_pose) to begin.%s",
              kColorGreen, kColorReset);
}

void Relocalizer::loadMap() {
  std::string path = map_path_;
  if (path.empty()) {
    // 默认路径:<package_share>/map/map.pcd
    std::string share_dir;
    try {
      share_dir = ament_index_cpp::get_package_share_directory("lio_relocalization");
    } catch (...) {
      share_dir = "";
    }
    if (!share_dir.empty()) {
      path = share_dir + "/map/map.pcd";
    } else {
      path = "map/map.pcd";
    }
  }

  if (pcl::io::loadPCDFile<PointT>(path, *map_cloud_) == -1) {
    RCLCPP_ERROR(this->get_logger(), "%s ---> Load map failed. File: %s%s",
                 kColorRed, path.c_str(), kColorReset);
    map_loaded_ = false;
    return;
  }

  // 移除地图中的 NaN 点,避免后续配准出现脏数据
  std::vector<int> idx;
  pcl::removeNaNFromPointCloud(*map_cloud_, *map_cloud_, idx);
  map_loaded_ = true;

  RCLCPP_INFO(this->get_logger(),
              "%s ---> Load map success. File: %s  size: %zu%s",
              kColorGreen, path.c_str(), map_cloud_->size(), kColorReset);
}

void Relocalizer::setupGlobalMapPublisher() {
  //用 1s wall 定时器发布地图,
  // 发布间隔逐步加速(1 -> 10s),最终稳定在每 10s 一次。
  if (map_cloud_ && map_cloud_->size() > 0) {
    pcl::toROSMsg(*map_cloud_, global_map_msg_);
    global_map_msg_.header.frame_id = map_frame_;
  }
  global_map_timer_ = this->create_wall_timer(
      std::chrono::seconds(1),
      [this]() {
        static int count = -1;
        static int publish_interval = 1;
        count++;
        if (count % publish_interval != 0) return;
        count = 0;
        publish_interval++;
        if (publish_interval > 10) publish_interval = 10;
        global_map_msg_.header.stamp = this->now();
        pub_global_map_->publish(global_map_msg_);
      });
}

// 外部 LIO 里程计回调:记录最新 odom 系下的机器人位姿及其仿真时钟时间戳,
// 用于配准成功后锚定 map->odom 修正量。
void Relocalizer::onOdom(const nav_msgs::msg::Odometry::SharedPtr msg) {
  const auto& p = msg->pose.pose.position;
  const auto& q = msg->pose.pose.orientation;
  Eigen::Quaterniond quat(q.w, q.x, q.y, q.z);
  quat.normalize();
  latest_odom_pose_ = Eigen::Isometry3d(quat);
  latest_odom_pose_.translation() = Eigen::Vector3d(p.x, p.y, p.z);
  latest_odom_stamp_ = msg->header.stamp;
  has_odom_ = true;
}

// IMU 回调:仅在配准阶段累加加速度,以增量方式计算均值(用于重力对齐)。
void Relocalizer::onImu(const sensor_msgs::msg::Imu::SharedPtr msg) {
  if (state_ != State::kAligning) return;
  Eigen::Vector3d acc(msg->linear_acceleration.x,
                      msg->linear_acceleration.y,
                      msg->linear_acceleration.z);
  imu_count_++;
  mean_acce_ += (acc - mean_acce_) / static_cast<double>(imu_count_);
}

// /initialpose 回调(RViz 2D Pose Estimate):用用户给定猜测覆盖默认初始位姿,并立即重置、进入新一轮对齐。z 强制为 0.2
void Relocalizer::onInitialPose(
    const geometry_msgs::msg::PoseWithCovarianceStamped::SharedPtr msg) {
  Eigen::Vector3d t(msg->pose.pose.position.x,
                    msg->pose.pose.position.y,
                    0.2);
  Eigen::Quaterniond q(msg->pose.pose.orientation.w,
                       msg->pose.pose.orientation.x,
                       msg->pose.pose.orientation.y,
                       msg->pose.pose.orientation.z);
  q.normalize();
  init_pose_t_ = t;
  init_pose_R_ = q.toRotationMatrix();
  got_init_pose_ = true;

  RCLCPP_INFO(this->get_logger(),
              "%s ---> GET Initial guess: %f %f  yaw(zxy) set%s",
              kColorYellow, t.x(), t.y(), kColorReset);

  // 启动一次全新的对齐尝试。
  resetAlignment();
  state_ = State::kAligning;
}

// 点云回调:核心驱动。等待位姿 -> 累积帧 -> 满阈值后做 NDT+ICP 配准。
void Relocalizer::onCloud(const sensor_msgs::msg::PointCloud2::SharedPtr msg) {
  if (!map_loaded_) return;

  if (state_ == State::kTracking) {
    return;  // 修正量已固定,TF 定时器负责广播
  }

  // 必须先获得初始位姿猜测(来自 /initialpose,或在就绪后首帧时用默认参数),
  // 并收到外部里程计后才能继续。
  if (state_ == State::kWaitPose) {
    // 若用户未发布 /initialpose,允许默认 init_pose 启动流程;
    // 仍要求默认值非平凡或显式给定。
    if (!got_init_pose_) {
      // 使用一次默认 init_pose 参数。
      got_init_pose_ = true;
    }
    state_ = State::kAligning;
  }

  if (state_ != State::kAligning) return;

  // 将本帧转换为 odom 系下的 PointXYZI 点云(外部 LIO 在 lidar_topic_ 上发布
  // 其 world/odom 系扫描,例如 /lio/cloud_world)。
  CloudPtr frame(new CloudT());
  pcl::fromROSMsg<PointT>(*msg, *frame);
  if (frame->empty()) return;

  // 体素降采样,降低配准计算量。
  pcl::VoxelGrid<PointT> vg;
  vg.setInputCloud(frame);
  double leaf = voxel_leaf_size_ > 0 ? voxel_leaf_size_ : 0.5;
  vg.setLeafSize(leaf, leaf, leaf);
  CloudPtr ds(new CloudT());
  vg.filter(*ds);

  // 累积帧(配准前需达到 need_init_frames 帧)。
  if (acc_frame_count_ < need_init_frames_) {
    *acc_cloud_ += *ds;
  }
  acc_frame_count_++;

  // 未达 IMU/帧数阈值则继续等待
  if (imu_count_ < need_imu_samples_) return;
  if (acc_frame_count_ < need_init_frames_) return;

  if (!tryAlign()) {
    resetAlignment();
    state_ = State::kWaitPose;  // 等待新的 /initialpose(或默认重试)
    return;
  }
  enterTracking();
}

// 执行 NDT+ICP 全局配准:源点云(odom 系累积扫描)对齐到地图。
// 成功则得到 map->odom 修正量 T_map_odom_ 与地图中机器人位姿 aligned_pose_。
bool Relocalizer::tryAlign() {
  if (!has_odom_) {
    RCLCPP_WARN(this->get_logger(),
                " ---> No external odom yet; cannot anchor map->odom. Waiting.");
    return false;
  }
  if (acc_cloud_->empty() || map_cloud_->empty()) return false;

  RCLCPP_INFO(this->get_logger(),
              "%s ---> INIT start... src size: %zu  target size: %zu%s",
              kColorYellow, acc_cloud_->size(), map_cloud_->size(), kColorReset);

  // ---- 重力对齐旋转----
  // gravity = -mean_acce * g / |mean_acce| ; 参考重力 ref = (0,0,-g)
  Eigen::Vector3d mean_acce = mean_acce_;
  if (mean_acce.norm() < 1e-6) mean_acce = Eigen::Vector3d(0, 0, -gravity_norm_);
  Eigen::Vector3d gravity = -mean_acce * gravity_norm_ / mean_acce.norm();
  Eigen::Vector3d ref_gravity(0, 0, -gravity_norm_);
  Eigen::Matrix3d init_rot =
      Eigen::Quaterniond::FromTwoVectors(gravity, ref_gravity).toRotationMatrix();
  // 消除重力对齐后绕 Z 的 yaw,得到仅含 roll/pitch 修正的姿态
  Eigen::Vector3d n = init_rot.col(0);
  double yaw = std::atan2(n(1), n(0));
  Eigen::Matrix3d R_yaw_inv =
      Eigen::AngleAxisd(-yaw, Eigen::Vector3d::UnitZ()).toRotationMatrix();
  Eigen::Matrix3d rot = R_yaw_inv * init_rot;

  // ---- 初始猜测:init_pose.R * rot, init_pose.t(与 :191-195 一致) ----
  Eigen::Matrix3d init_guess_R = init_pose_R_ * rot;
  Eigen::Vector3d init_guess_t = init_pose_t_;
  Eigen::Matrix4d init_guess_T = Eigen::Matrix4d::Identity();
  init_guess_T.block<3, 3>(0, 0) = init_guess_R;
  init_guess_T.block<3, 1>(0, 3) = init_guess_t;

  // ---- 先 NDT 再 ICP(与 :201-221 一致) ----
  pcl::PointCloud<pcl::PointXYZI>::Ptr src(
      new pcl::PointCloud<pcl::PointXYZI>());
  pcl::copyPointCloud(*acc_cloud_, *src);

  pcl::NormalDistributionsTransform<pcl::PointXYZI, pcl::PointXYZI> ndt;
  ndt.setTransformationEpsilon(ndt_transformation_epsilon_);
  ndt.setEuclideanFitnessEpsilon(ndt_fitness_epsilon_);
  ndt.setMaximumIterations(ndt_max_iterations_);
  ndt.setResolution(ndt_resolution_);
  ndt.setInputTarget(map_cloud_);

  pcl::IterativeClosestPoint<pcl::PointXYZI, pcl::PointXYZI> icp;
  icp.setMaxCorrespondenceDistance(icp_max_correspondence_distance_);
  icp.setMaximumIterations(icp_max_iterations_);
  icp.setTransformationEpsilon(icp_transformation_epsilon_);
  icp.setEuclideanFitnessEpsilon(icp_fitness_epsilon_);
  icp.setRANSACIterations(icp_ransac_iterations_);
  icp.setInputTarget(map_cloud_);

  ndt.setInputSource(src);
  icp.setInputSource(src);

  // NDT 用初始猜测对齐,ICP 以 NDT 结果作为初值进一步精配
  pcl::PointCloud<pcl::PointXYZI>::Ptr unused(
      new pcl::PointCloud<pcl::PointXYZI>());
  ndt.align(*unused, init_guess_T.matrix().cast<float>());
  icp.align(*unused, ndt.getFinalTransformation());

  // 收敛门限:ICP 未收敛或 fitness 超过阈值即判失败,触发重置重试
  if (!icp.hasConverged() ||
      icp.getFitnessScore() > static_cast<float>(fitness_threshold_)) {
    RCLCPP_ERROR(this->get_logger(),
                 "%s ---> Global ICP Converged Fail! FitnessScore: %f%s",
                 kColorRed, icp.getFitnessScore(), kColorReset);
    return false;
  }

  Eigen::Matrix4d T = icp.getFinalTransformation().cast<double>();
  RCLCPP_INFO(this->get_logger(),
              "%s ---> Global ICP Converged Succeed! FitnessScore: %f%s",
              kColorGreen, icp.getFitnessScore(), kColorReset);
  RCLCPP_INFO(this->get_logger(), "%s\n%s%s", kColorGreen,
              [&T]() {
                std::ostringstream os;
                os << T;
                return os.str();
              }().c_str(),
              kColorReset);

  // T 将 odom 系点云(源点云已在 odom 系)映射到 map 系:p_map = T * p_odom。
  // 因此 T 本身就是 map->odom 变换(作为 odom 坐标到 map 坐标的映射)。
  Eigen::Isometry3d T_map_odom(T);

  // 机器人在地图中的对齐位姿:T_map_base = T_map_odom * T_odom_base
  aligned_pose_ = T_map_odom * latest_odom_pose_;

  T_map_odom_ = T_map_odom;
  has_correction_ = true;
  return true;
}

// 清空累积量并回到等待位姿状态,为下一次对齐做准备。
void Relocalizer::resetAlignment() {
  acc_cloud_->clear();
  acc_frame_count_ = 0;
  imu_count_ = 0;
  mean_acce_ = Eigen::Vector3d::Zero();
  got_init_pose_ = false;
}

// 进入跟踪态:发布位姿、启动 TF 定时器、释放 /initialpose 订阅。
void Relocalizer::enterTracking() {
  state_ = State::kTracking;
  RCLCPP_INFO(this->get_logger(), "%s ---> [relocalization]: tracking. "
              "Broadcasting map(%s)->odom(%s) TF.%s",
              kColorGreen, map_frame_.c_str(), odom_frame_.c_str(), kColorReset);

  publishPose();

  // 初始化成功后释放 /initialpose 订阅
  if (sub_initialpose_) sub_initialpose_.reset();

  // 持续广播 map->odom,使(移动中的)外部里程计锁定到地图。
  // 修正量本身固定不变,每个 tick 仅重新打时间戳。
  tf_timer_ = this->create_wall_timer(
      std::chrono::duration_cast<std::chrono::nanoseconds>(
          std::chrono::duration<double>(tf_publish_period_)),
      [this]() { broadcastTf(); });
}

// 发布机器人在地图中的对齐位姿。
void Relocalizer::publishPose() {
  if (!has_correction_) return;
  geometry_msgs::msg::PoseStamped pose;
  // 用最新 odom 仿真时钟时间戳给对齐位姿打标(理由同 broadcastTf);
  // 否则回退到 this->now()。
  if (has_odom_) {
    pose.header.stamp = latest_odom_stamp_;
  } else {
    pose.header.stamp = this->now();
  }
  pose.header.frame_id = map_frame_;
  pose.pose.position.x = aligned_pose_.translation().x();
  pose.pose.position.y = aligned_pose_.translation().y();
  pose.pose.position.z = aligned_pose_.translation().z();
  Eigen::Quaterniond q(aligned_pose_.rotation());
  q.normalize();
  pose.pose.orientation.x = q.x();
  pose.pose.orientation.y = q.y();
  pose.pose.orientation.z = q.z();
  pose.pose.orientation.w = q.w();
  pub_pose_->publish(pose);
}

// 广播(固定的)map->odom 修正量 TF。
void Relocalizer::broadcastTf() {
  if (!has_correction_) return;
  geometry_msgs::msg::TransformStamped tf;
  // 用最新 odom 仿真时钟时间戳给(固定的)map->odom 修正量打标,使其与
  // Nav2 变换所依赖的 odom->base_footprint 数据对齐。尚未收到 odom 时
  // 回退到 this->now()(use_sim_time=true 时即仿真时间)。
  if (has_odom_) {
    tf.header.stamp = latest_odom_stamp_;
  } else {
    tf.header.stamp = this->now();
  }
  tf.header.frame_id = map_frame_;
  tf.child_frame_id = odom_frame_;
  Eigen::Quaterniond q(T_map_odom_.rotation());
  q.normalize();
  tf.transform.translation.x = T_map_odom_.translation().x();
  tf.transform.translation.y = T_map_odom_.translation().y();
  tf.transform.translation.z = T_map_odom_.translation().z();
  tf.transform.rotation.x = q.x();
  tf.transform.rotation.y = q.y();
  tf.transform.rotation.z = q.z();
  tf.transform.rotation.w = q.w();
  tf_broadcaster_->sendTransform(tf);
}

}  // namespace lio_relocalization

int main(int argc, char** argv) {
  rclcpp::init(argc, argv);
  rclcpp::spin(std::make_shared<lio_relocalization::Relocalizer>());
  rclcpp::shutdown();
  return 0;
}
