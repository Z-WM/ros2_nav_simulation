#include "nav2_waypoint_panel/waypoint_panel.hpp"
#include "rviz_common/display_context.hpp"
#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QGridLayout>
#include <QFileDialog>
#include <fstream>
#include <iomanip>

namespace nav2_waypoint_panel
{

WaypointPanel::WaypointPanel(QWidget * parent)
: rviz_common::Panel(parent)
{
  QVBoxLayout * main_layout = new QVBoxLayout;

  // --- Dashboard Section ---
  QFrame * dashboard = new QFrame;
  dashboard->setFrameStyle(QFrame::StyledPanel | QFrame::Raised);
  dashboard->setStyleSheet("background-color: #f0f0f0; border-radius: 8px; padding: 5px;");
  QGridLayout * dash_layout = new QGridLayout(dashboard);

  auto addDashField = [&](int row, QString label, QLabel*& val_label, QString init_val) {
    QLabel * l = new QLabel(label);
    l->setStyleSheet("font-weight: bold; color: #333;");
    val_label = new QLabel(init_val);
    dash_layout->addWidget(l, row, 0);
    dash_layout->addWidget(val_label, row, 1, Qt::AlignRight);
  };

  addDashField(0, "Navigation:", nav_status_val_, "inactive");
  addDashField(1, "Localization:", loc_status_val_, "inactive");
  addDashField(2, "Feedback:", feedback_val_, "unknown");
  
  // Separation line
  QFrame* line = new QFrame();
  line->setFrameShape(QFrame::HLine);
  line->setFrameShadow(QFrame::Sunken);
  dash_layout->addWidget(line, 3, 0, 1, 2);

  addDashField(4, "Poses remaining:", poses_rem_val_, "0");
  addDashField(5, "ETA:", eta_val_, "0 s");
  addDashField(6, "Distance remaining:", dist_rem_val_, "0.00 m");
  addDashField(7, "Time taken:", time_taken_val_, "0 s");
  addDashField(8, "Recoveries:", recoveries_val_, "0");

  main_layout->addWidget(dashboard);

  // --- Waypoint List Section ---
  waypoint_list_ = new QListWidget;
  waypoint_list_->setStyleSheet("background-color: #ffffff; border: 1px solid #ccc; font-size: 10px;");
  waypoint_list_->setContextMenuPolicy(Qt::CustomContextMenu);
  connect(waypoint_list_, SIGNAL(customContextMenuRequested(const QPoint &)), this, SLOT(showContextMenu(const QPoint &)));

  main_layout->addWidget(new QLabel("Waypoints (Use tool on /waypoint):"));
  main_layout->addWidget(waypoint_list_);

  // --- Controls Section ---
  QGridLayout * ctrl_layout = new QGridLayout;
  start_button_ = new QPushButton("Start Nav");
  restart_button_ = new QPushButton("Restart All");
  cancel_button_ = new QPushButton("Stop Nav");
  clear_button_ = new QPushButton("Clear All");

  mode_selector_ = new QComboBox;
  mode_selector_->addItem("Follow Waypoints (stop at each)",
    static_cast<int>(NavMode::FollowWaypoints));
  mode_selector_->addItem("Navigate Through Poses (continuous)",
    static_cast<int>(NavMode::NavigateThroughPoses));
  ctrl_layout->addWidget(new QLabel("Mode:"), 0, 0);
  ctrl_layout->addWidget(mode_selector_, 0, 1);

  ctrl_layout->addWidget(start_button_, 1, 0);
  ctrl_layout->addWidget(restart_button_, 1, 1);
  ctrl_layout->addWidget(cancel_button_, 2, 0);
  ctrl_layout->addWidget(clear_button_, 2, 1);

  main_layout->addLayout(ctrl_layout);

  // --- File I/O Section ---
  QHBoxLayout * file_layout = new QHBoxLayout;
  load_button_ = new QPushButton("Load File");
  export_button_ = new QPushButton("Export File");
  file_layout->addWidget(load_button_);
  file_layout->addWidget(export_button_);
  main_layout->addLayout(file_layout);

  setLayout(main_layout);

  // Slots
  connect(start_button_, SIGNAL(clicked()), this, SLOT(onStartNavigation()));
  connect(restart_button_, SIGNAL(clicked()), this, SLOT(onRestartNavigation()));
  connect(clear_button_, SIGNAL(clicked()), this, SLOT(onClearWaypoints()));
  connect(cancel_button_, SIGNAL(clicked()), this, SLOT(onCancelNavigation()));
  connect(load_button_, SIGNAL(clicked()), this, SLOT(onLoadWaypoints()));
  connect(export_button_, SIGNAL(clicked()), this, SLOT(onExportWaypoints()));
  connect(mode_selector_, SIGNAL(currentIndexChanged(int)), this, SLOT(onModeChanged(int)));

  status_timer_ = new QTimer(this);
  connect(status_timer_, &QTimer::timeout, this, &WaypointPanel::checkSystemStatus);
  status_timer_->start(1000);
}

WaypointPanel::~WaypointPanel()
{
}

void WaypointPanel::onInitialize()
{
  node_ = getDisplayContext()->getRosNodeAbstraction().lock()->get_raw_node();

  goal_sub_ = node_->create_subscription<geometry_msgs::msg::PoseStamped>(
    "/waypoint", 10, [this](const geometry_msgs::msg::PoseStamped::SharedPtr msg) {
      waypoints_.push_back(*msg);
      updateWaypointList();
      updateMarkers();
    });

  marker_pub_ = node_->create_publisher<visualization_msgs::msg::MarkerArray>("waypoint_markers", 10);
  action_client_ = rclcpp_action::create_client<nav2_msgs::action::FollowWaypoints>(node_, "follow_waypoints");
  ntp_action_client_ = rclcpp_action::create_client<nav2_msgs::action::NavigateThroughPoses>(node_, "navigate_through_poses");

  // Subscribe to generic nav info (using navigate_to_pose feedback as a proxy for stats)
  nav_feedback_sub_ = node_->create_subscription<nav2_msgs::action::NavigateToPose::Impl::FeedbackMessage>(
    "navigate_to_pose/_action/feedback", 10, 
    [this](const nav2_msgs::action::NavigateToPose::Impl::FeedbackMessage::SharedPtr msg) {
      updateDashboard(msg->feedback);
    });
}

void WaypointPanel::updateDashboard(const nav2_msgs::action::NavigateToPose::Feedback & fb)
{
  eta_val_->setText(QString("%1 s").arg(rclcpp::Duration(fb.estimated_time_remaining).seconds(), 0, 'f', 0));
  dist_rem_val_->setText(QString("%1 m").arg(fb.distance_remaining, 0, 'f', 2));
  time_taken_val_->setText(QString("%1 s").arg(rclcpp::Duration(fb.navigation_time).seconds(), 0, 'f', 0));
  recoveries_val_->setText(QString::number(fb.number_of_recoveries));
}

void WaypointPanel::updateDashboard(const nav2_msgs::action::NavigateThroughPoses::Feedback & fb)
{
  // NTP feedback carries the same dashboard fields as NavigateToPose::Feedback.
  // bt_navigator does not publish on navigate_to_pose/_action/feedback while
  // running navigate_through_poses, so the dashboard must be fed from here.
  eta_val_->setText(QString("%1 s").arg(rclcpp::Duration(fb.estimated_time_remaining).seconds(), 0, 'f', 0));
  dist_rem_val_->setText(QString("%1 m").arg(fb.distance_remaining, 0, 'f', 2));
  time_taken_val_->setText(QString("%1 s").arg(rclcpp::Duration(fb.navigation_time).seconds(), 0, 'f', 0));
  recoveries_val_->setText(QString::number(fb.number_of_recoveries));
}

void WaypointPanel::checkSystemStatus()
{
  // If we haven't received feedback for 2 seconds, assume inactive
  // This is a safety fallback for the UI
}

void WaypointPanel::onExportWaypoints()
{
  QString fileName = QFileDialog::getSaveFileName(this, "Export Waypoints", "", "Text Files (*.txt);;CSV Files (*.csv)");
  if (fileName.isEmpty()) return;

  std::ofstream out(fileName.toStdString());
  for (const auto& wp : waypoints_) {
    out << wp.pose.position.x << "," << wp.pose.position.y << "," << wp.pose.position.z << ","
        << wp.pose.orientation.x << "," << wp.pose.orientation.y << "," << wp.pose.orientation.z << "," << wp.pose.orientation.w << "\n";
  }
  out.close();
  feedback_val_->setText("Exported OK");
}

void WaypointPanel::onLoadWaypoints()
{
  QString fileName = QFileDialog::getOpenFileName(this, "Load Waypoints", "", "Text Files (*.txt);;CSV Files (*.csv)");
  if (fileName.isEmpty()) return;

  waypoints_.clear();
  waypoint_list_->clear();

  std::ifstream in(fileName.toStdString());
  std::string line;
  while (std::getline(in, line)) {
    std::stringstream ss(line);
    std::string val;
    std::vector<double> v;
    while (std::getline(ss, val, ',')) v.push_back(std::stod(val));

    if (v.size() >= 7) {
      geometry_msgs::msg::PoseStamped p;
      p.header.frame_id = "map";
      p.header.stamp = node_->now();
      p.pose.position.x = v[0]; p.pose.position.y = v[1]; p.pose.position.z = v[2];
      p.pose.orientation.x = v[3]; p.pose.orientation.y = v[4]; p.pose.orientation.z = v[5]; p.pose.orientation.w = v[6];
      waypoints_.push_back(p);
    }
  }
  updateWaypointList();
  updateMarkers();
  feedback_val_->setText("Loaded OK");
}

void WaypointPanel::onStartNavigation()
{
  if (waypoints_.empty()) return;

  // Cancel any existing goal before starting a new one
  cancelActiveGoal();

  selected_mode_ = static_cast<NavMode>(mode_selector_->currentData().toInt());
  active_mode_ = selected_mode_;

  std::vector<geometry_msgs::msg::PoseStamped> poses;
  if (selected_mode_ == NavMode::NavigateThroughPoses) {
    // NTP: resume from the last unpassed pose (skip poses already passed in the
    // previous run). ntp_passed_count_ is maintained by the NTP feedback callback.
    uint32_t start = std::min(ntp_passed_count_, static_cast<uint32_t>(waypoints_.size()));
    poses.assign(waypoints_.begin() + start, waypoints_.end());
    if (poses.empty()) {
      // All poses already passed -> restart from the beginning.
      ntp_passed_count_ = 0;
      poses = waypoints_;
    }
    sendNavigateThroughPoses(poses);
    return;
  }

  // FollowWaypoints: resume from the current waypoint index.
  if (current_waypoint_index_ < waypoints_.size()) {
    poses.assign(waypoints_.begin() + current_waypoint_index_, waypoints_.end());
  } else {
    poses = waypoints_;
    current_waypoint_index_ = 0;
  }
  nav_start_index_ = current_waypoint_index_;
  sendWaypointGoal(poses);
}


void WaypointPanel::onRestartNavigation()
{
  if (waypoints_.empty()) return;

  // Cancel existing goal
  cancelActiveGoal();

  current_waypoint_index_ = 0;
  nav_start_index_ = 0;
  ntp_passed_count_ = 0;
  selected_mode_ = static_cast<NavMode>(mode_selector_->currentData().toInt());
  active_mode_ = selected_mode_;
  if (selected_mode_ == NavMode::NavigateThroughPoses) {
    sendNavigateThroughPoses(waypoints_);
  } else {
    sendWaypointGoal(waypoints_);
  }
}


void WaypointPanel::sendWaypointGoal(const std::vector<geometry_msgs::msg::PoseStamped>& poses)
{
  if (!action_client_->wait_for_action_server(std::chrono::seconds(2))) {
    feedback_val_->setText("No Server");
    return;
  }

  auto goal_msg = nav2_msgs::action::FollowWaypoints::Goal();
  goal_msg.poses = poses;

  auto opts = rclcpp_action::Client<nav2_msgs::action::FollowWaypoints>::SendGoalOptions();
  opts.goal_response_callback = [this](auto handle) {
    if (!handle) { 
      feedback_val_->setText("Rejected"); 
      is_navigating_ = false; 
      nav_status_val_->setText("inactive");
    }
    else { 
      feedback_val_->setText("Accepted"); 
      current_goal_handle_ = handle; 
      is_navigating_ = true; 
      nav_status_val_->setText("<font color=green>active</font>"); 
    }
  };
  opts.result_callback = [this](const rclcpp_action::ClientGoalHandle<nav2_msgs::action::FollowWaypoints>::WrappedResult & result) { 
    is_navigating_ = false; 
    current_goal_handle_ = nullptr; 
    nav_status_val_->setText("inactive");
    
    switch (result.code) {
      case rclcpp_action::ResultCode::SUCCEEDED:
        feedback_val_->setText("Finished");
        current_waypoint_index_ = 0;
        // Reset highlights
        for (int i = 0; i < waypoint_list_->count(); ++i) waypoint_list_->item(i)->setBackground(Qt::transparent);
        break;
      case rclcpp_action::ResultCode::CANCELED:
        feedback_val_->setText("Canceled");
        break;
      case rclcpp_action::ResultCode::ABORTED:
        feedback_val_->setText("Aborted");
        break;
      default:
        feedback_val_->setText("Stopped");
        break;
    }
  };
  opts.feedback_callback = [this](auto, auto fb) {
    is_navigating_ = true;
    nav_status_val_->setText("<font color=green>active</font>");
    current_waypoint_index_ = nav_start_index_ + fb->current_waypoint;
    feedback_val_->setText(QString("WP %1").arg(current_waypoint_index_ + 1));
    
    // Highlight the active waypoint in the list (Deep Orange)
    for (int i = 0; i < waypoint_list_->count(); ++i) {
      if (i == (int)current_waypoint_index_) {
        waypoint_list_->item(i)->setBackground(QColor(255, 69, 0, 220)); // Deep Orange Red
        waypoint_list_->item(i)->setForeground(Qt::white); // White text
      } else {
        waypoint_list_->item(i)->setBackground(Qt::transparent);
        waypoint_list_->item(i)->setForeground(Qt::black);
      }
    }


    int remaining = waypoints_.size() - (current_waypoint_index_ + 1);
    poses_rem_val_->setText(QString::number(std::max(0, (int)remaining)));
  };

  action_client_->async_send_goal(goal_msg, opts);
}

void WaypointPanel::sendNavigateThroughPoses(const std::vector<geometry_msgs::msg::PoseStamped>& poses)
{
  if (!ntp_action_client_->wait_for_action_server(std::chrono::seconds(2))) {
    feedback_val_->setText("No NTP Server");
    return;
  }

  auto goal_msg = nav2_msgs::action::NavigateThroughPoses::Goal();
  goal_msg.poses = poses;
  // behavior_tree left empty so bt_navigator uses its default NTP behavior tree.

  auto opts = rclcpp_action::Client<nav2_msgs::action::NavigateThroughPoses>::SendGoalOptions();
  opts.goal_response_callback = [this](auto handle) {
    if (!handle) {
      feedback_val_->setText("Rejected");
      is_navigating_ = false;
      nav_status_val_->setText("inactive");
    } else {
      feedback_val_->setText("Accepted");
      ntp_goal_handle_ = handle;
      active_mode_ = NavMode::NavigateThroughPoses;
      is_navigating_ = true;
      nav_status_val_->setText("<font color=green>active</font>");
    }
  };
  opts.result_callback = [this](const rclcpp_action::ClientGoalHandle<nav2_msgs::action::NavigateThroughPoses>::WrappedResult & result) {
    is_navigating_ = false;
    ntp_goal_handle_ = nullptr;
    nav_status_val_->setText("inactive");

    switch (result.code) {
      case rclcpp_action::ResultCode::SUCCEEDED:
        feedback_val_->setText("Finished");
        current_waypoint_index_ = 0;
        ntp_passed_count_ = 0;
        // Reset highlights
        for (int i = 0; i < waypoint_list_->count(); ++i) {
          waypoint_list_->item(i)->setBackground(Qt::transparent);
          waypoint_list_->item(i)->setForeground(Qt::black);
        }
        break;
      case rclcpp_action::ResultCode::CANCELED:
        feedback_val_->setText("Canceled");
        break;
      case rclcpp_action::ResultCode::ABORTED:
        feedback_val_->setText("Aborted");
        break;
      default:
        feedback_val_->setText("Stopped");
        break;
    }
  };
  opts.feedback_callback = [this](auto, auto fb) {
    is_navigating_ = true;
    nav_status_val_->setText("<font color=green>active</font>");
    active_mode_ = NavMode::NavigateThroughPoses;

    // Feed the dashboard from NTP feedback (same fields as NavigateToPose::Feedback).
    updateDashboard(*fb);

    // Track passed poses so Start Nav can resume from the last unpassed pose.
    // number_of_poses_remaining counts goals still to reach in the BT's pruned
    // list; passed = total sent this batch - remaining.
    ntp_passed_count_ = static_cast<uint32_t>(
      std::max(0, static_cast<int>(waypoints_.size()) -
      static_cast<int>(fb->number_of_poses_remaining)));
    if (ntp_passed_count_ > waypoints_.size()) ntp_passed_count_ = waypoints_.size();

    poses_rem_val_->setText(QString::number(fb->number_of_poses_remaining));
    feedback_val_->setText(QString("NTP %1 m").arg(fb->distance_remaining, 0, 'f', 2));

    // NTP has no per-waypoint index; highlight the whole list with a light accent
    // to signal that a continuous path is active (no fake single-item cursor).
    for (int i = 0; i < waypoint_list_->count(); ++i) {
      waypoint_list_->item(i)->setBackground(QColor(100, 149, 237, 120));  // cornflower blue
      waypoint_list_->item(i)->setForeground(Qt::black);
    }
  };

  ntp_action_client_->async_send_goal(goal_msg, opts);
}

void WaypointPanel::onClearWaypoints()
{
  waypoints_.clear();
  waypoint_list_->clear();
  current_waypoint_index_ = 0;
  ntp_passed_count_ = 0;
  updateMarkers();
  feedback_val_->setText("Cleared");
}

void WaypointPanel::onCancelNavigation()
{
  if (active_mode_ == NavMode::NavigateThroughPoses && ntp_goal_handle_) {
    feedback_val_->setText("Stopping...");
    ntp_action_client_->async_cancel_goal(ntp_goal_handle_);
  } else if (current_goal_handle_) {
    feedback_val_->setText("Stopping...");
    action_client_->async_cancel_goal(current_goal_handle_);
  } else {
    is_navigating_ = false;
    nav_status_val_->setText("inactive");
    feedback_val_->setText("No active goal");
  }
}

void WaypointPanel::cancelActiveGoal()
{
  if (active_mode_ == NavMode::NavigateThroughPoses && ntp_goal_handle_) {
    ntp_action_client_->async_cancel_goal(ntp_goal_handle_);
  } else if (current_goal_handle_) {
    action_client_->async_cancel_goal(current_goal_handle_);
  }
}

void WaypointPanel::onModeChanged(int /*index*/)
{
  // Block switching while a navigation goal is in flight; the user must Stop first.
  if (is_navigating_) {
    mode_selector_->blockSignals(true);
    mode_selector_->setCurrentIndex(active_mode_ == NavMode::NavigateThroughPoses ? 1 : 0);
    mode_selector_->blockSignals(false);
    feedback_val_->setText("Stop nav before switching mode");
    return;
  }
  selected_mode_ = static_cast<NavMode>(mode_selector_->currentData().toInt());
}



void WaypointPanel::load(const rviz_common::Config & config) { rviz_common::Panel::load(config); }
void WaypointPanel::save(rviz_common::Config config) const { rviz_common::Panel::save(config); }

void WaypointPanel::updateWaypointList()
{
  waypoint_list_->clear();
  for (size_t i = 0; i < waypoints_.size(); ++i) {
    QString item_text = QString("[%1] %2, %3").arg(i + 1)
                        .arg(waypoints_[i].pose.position.x, 0, 'f', 2)
                        .arg(waypoints_[i].pose.position.y, 0, 'f', 2);
    waypoint_list_->addItem(item_text);
  }
}

void WaypointPanel::showContextMenu(const QPoint & pos)
{
  QListWidgetItem * item = waypoint_list_->itemAt(pos);
  if (!item) return;

  waypoint_list_->setCurrentItem(item);

  QMenu menu(this);
  
  if (waypoint_list_->currentRow() > 0) {
    QAction * moveUpAction = menu.addAction("Move Up");
    connect(moveUpAction, SIGNAL(triggered()), this, SLOT(onMoveWaypointUp()));
  }

  if (waypoint_list_->currentRow() < waypoint_list_->count() - 1) {
    QAction * moveDownAction = menu.addAction("Move Down");
    connect(moveDownAction, SIGNAL(triggered()), this, SLOT(onMoveWaypointDown()));
  }

  QAction * deleteAction = menu.addAction("Delete Waypoint");
  connect(deleteAction, SIGNAL(triggered()), this, SLOT(onDeleteWaypoint()));
  
  menu.exec(waypoint_list_->mapToGlobal(pos));
}

void WaypointPanel::onMoveWaypointUp()
{
  int currentRow = waypoint_list_->currentRow();
  if (currentRow > 0 && currentRow < (int)waypoints_.size()) {
    std::swap(waypoints_[currentRow], waypoints_[currentRow - 1]);
    updateWaypointList();
    updateMarkers();
    waypoint_list_->setCurrentRow(currentRow - 1);
    feedback_val_->setText(QString("Moved WP %1 Up").arg(currentRow + 1));
  }
}

void WaypointPanel::onMoveWaypointDown()
{
  int currentRow = waypoint_list_->currentRow();
  if (currentRow >= 0 && currentRow < (int)waypoints_.size() - 1) {
    std::swap(waypoints_[currentRow], waypoints_[currentRow + 1]);
    updateWaypointList();
    updateMarkers();
    waypoint_list_->setCurrentRow(currentRow + 1);
    feedback_val_->setText(QString("Moved WP %1 Down").arg(currentRow + 1));
  }
}

void WaypointPanel::onDeleteWaypoint()
{
  int currentRow = waypoint_list_->currentRow();
  if (currentRow >= 0 && currentRow < (int)waypoints_.size()) {
    waypoints_.erase(waypoints_.begin() + currentRow);
    updateWaypointList();
    updateMarkers();
    feedback_val_->setText(QString("Deleted WP %1").arg(currentRow + 1));
  }
}

void WaypointPanel::updateMarkers()
{
  visualization_msgs::msg::MarkerArray markers;
  visualization_msgs::msg::Marker clear;
  clear.action = visualization_msgs::msg::Marker::DELETEALL;
  markers.markers.push_back(clear);
  marker_pub_->publish(markers);
  markers.markers.clear();

  for (size_t i = 0; i < waypoints_.size(); ++i) {
    // --- Slim Green Pointer Style ---
    
    // 1. Sleek Floating Arrow (Pure Green)
    visualization_msgs::msg::Marker arrow;
    arrow.header = waypoints_[i].header;
    arrow.id = i;
    arrow.type = visualization_msgs::msg::Marker::ARROW;
    arrow.action = visualization_msgs::msg::Marker::ADD;
    arrow.pose = waypoints_[i].pose;
    arrow.pose.position.z = 0.05; 
    
    // Slim proportions
    arrow.scale.x = 0.7;  // length
    arrow.scale.y = 0.1;  // width
    arrow.scale.z = 0.1;  // height
    
    arrow.color.r = 0.0; arrow.color.g = 1.0; arrow.color.b = 0.0; arrow.color.a = 1.0;
    markers.markers.push_back(arrow);

    // 2. Bold Order Number
    visualization_msgs::msg::Marker text;
    text.header = waypoints_[i].header;
    text.id = i + 1000;
    text.type = visualization_msgs::msg::Marker::TEXT_VIEW_FACING;
    text.pose = waypoints_[i].pose;
    text.pose.position.z = 0.45;
    text.scale.z = 0.45;
    text.color.r = 0.0; text.color.g = 0.0; text.color.b = 0.0; text.color.a = 1.0;
    text.text = std::to_string(i + 1);
    markers.markers.push_back(text);
  }




  marker_pub_->publish(markers);
}

}  // namespace nav2_waypoint_panel

#include <pluginlib/class_list_macros.hpp>
PLUGINLIB_EXPORT_CLASS(nav2_waypoint_panel::WaypointPanel, rviz_common::Panel)
