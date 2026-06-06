import sys, rclpy, json, os
from rclpy.node import Node
from ament_index_python.packages import get_package_share_directory
from std_msgs.msg import Header
from PyQt6.QtWidgets import (QApplication, QWidget, QVBoxLayout, QHBoxLayout, 
                             QSpinBox, QDoubleSpinBox, QPushButton, QLabel, QFrame, 
                             QProgressBar, QGraphicsDropShadowEffect, QGridLayout,
                             QScrollArea, QDialog, QLineEdit, QComboBox, QFileDialog,
                             QMessageBox)
from PyQt6.QtCore import QTimer, Qt
from PyQt6.QtGui import QColor, QFont

# 配置文件路径：使用 ament_index_python 获得 share 目录
# 配置文件路径解析逻辑优化
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SOURCE_PKG_DIR = os.path.dirname(SCRIPT_DIR)
SOURCE_CONFIG_DIR = os.path.join(SOURCE_PKG_DIR, "config")

# 如果源码目录下的 config 存在，优先使用它（支持 colcon build --symlink-install 下的直接修改）
if os.path.exists(SOURCE_CONFIG_DIR):
    CONFIG_DIR = SOURCE_CONFIG_DIR
else:
    try:
        from ament_index_python.packages import get_package_share_directory
        PKG_SHARE_DIR = get_package_share_directory('dynamic_message_dashboard_ros2')
        CONFIG_DIR = os.path.join(PKG_SHARE_DIR, "config")
    except Exception:
        CONFIG_DIR = SOURCE_CONFIG_DIR

CONFIG_FILE = os.path.join(CONFIG_DIR, "config_auto_save.json")
DEFAULT_CONFIG_FILE = os.path.join(CONFIG_DIR, "default_config.json")

# 确保配置目录存在 (如果无权限可能会报错，但通常 install/share 目录对当前用户是可读写的)
os.makedirs(CONFIG_DIR, exist_ok=True)

# 调试信息
print(f"默认配置文件: {DEFAULT_CONFIG_FILE}")
print(f"默认配置文件是否存在: {os.path.exists(DEFAULT_CONFIG_FILE)}")

# --- 核心：移除箭头的 AddParamDialog ---
class AddParamDialog(QDialog):
    def __init__(self, categories, types, type_configs, parent=None):
        super().__init__(parent)
        self.setWindowTitle("添加新变量")
        self.setMinimumSize(420, 650)  # 改为最小尺寸，允许拉伸
        self.setWindowFlags(Qt.WindowType.Dialog | Qt.WindowType.WindowCloseButtonHint) # 允许常规对话框操作
        self.type_configs = type_configs
        
        # 移除了所有箭头相关的绘制代码，仅保留输入框样式
        self.setStyleSheet("""
            QDialog { 
                background-color: #FFFFFF; 
                border-radius: 24px; 
                border: 1px solid #E5E5EA; 
            }
            QLabel { 
                color: #8E8E93; 
                font-weight: 800; 
                font-size: 13px; 
                text-transform: uppercase; 
                letter-spacing: 0.5px;
            }
            
            QLineEdit, QComboBox { 
                background-color: #FFFFFF; 
                border-radius: 12px; 
                padding: 14px 16px; 
                font-size: 15px; 
                border: 2px solid #E5E5EA; 
                color: #1C1C1E;
            }
            
            /* 移除箭头占位，平衡左右内边距 */
            QComboBox { padding-right: 16px; }
            
            QLineEdit:focus, QComboBox:focus { 
                border: 2px solid #007AFF; 
                background-color: #FFFFFF; 
            }

            /* 彻底移除下拉箭头子控件 */
            QComboBox::drop-down {
                width: 0px;
                border: none;
            }
            QComboBox::down-arrow {
                image: none;
            }

            QComboBox QAbstractItemView { 
                background-color: #FFFFFF; 
                border: 1px solid #E5E5EA; 
                border-radius: 12px; 
                selection-background-color: #007AFF; 
                selection-color: white; 
                outline: none;
                padding: 8px;
            }

            QPushButton#save { 
                background-color: #007AFF; 
                color: white; 
                border-radius: 16px; 
                font-weight: 800; 
                font-size: 16px; 
                border: none; 
            }
            QPushButton#save:hover { 
                background-color: #0063CC; 
            }
            
            QPushButton#cancel { 
                background-color: #F2F2F7; 
                color: #1C1C1E; 
                border-radius: 16px; 
                font-weight: 800; 
                font-size: 16px; 
                border: none; 
            }
            QPushButton#cancel:hover { 
                background-color: #E5E5EA; 
            }
        """)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(32, 38, 32, 38)
        layout.setSpacing(22)
        
        title = QLabel("配置新话题变量")
        title.setStyleSheet("font-size: 24px; color: #1C1C1E; font-weight: 900; text-transform: none; margin-bottom: 8px; letter-spacing: -0.5px;")
        layout.addWidget(title)

        v_name_box = QVBoxLayout()
        v_name_box.setSpacing(8)
        v_name_box.addWidget(QLabel("变量名称 (MSG 字段名)"))
        self.name_input = QLineEdit()
        self.name_input.setPlaceholderText("例如: armor_id")
        v_name_box.addWidget(self.name_input)
        layout.addLayout(v_name_box)

        row = QHBoxLayout()
        row.setSpacing(15)
        v_type = QVBoxLayout()
        v_type.setSpacing(8)
        v_cat = QVBoxLayout()
        v_cat.setSpacing(8)
        
        v_type.addWidget(QLabel("数据类型"))
        self.type_combo = QComboBox()
        self.type_combo.addItems(types)
        self.type_combo.currentTextChanged.connect(self.on_type_changed)
        v_type.addWidget(self.type_combo)
        
        v_cat.addWidget(QLabel("所属分类"))
        self.cat_combo = QComboBox()
        self.cat_combo.addItems(categories)
        v_cat.addWidget(self.cat_combo)
        
        row.addLayout(v_type)
        row.addLayout(v_cat)
        layout.addLayout(row)

        # 范围设置（仅数值类型）
        self.range_container = QWidget()
        range_layout = QVBoxLayout(self.range_container)
        range_layout.setContentsMargins(0, 0, 0, 0)
        range_layout.setSpacing(12)
        
        range_label = QLabel("数值范围设置")
        range_label.setStyleSheet("font-size: 14px; color: #1C1C1E; font-weight: 700; text-transform: none;")
        range_layout.addWidget(range_label)
        
        range_inputs = QHBoxLayout()
        range_inputs.setSpacing(12)
        
        min_box = QVBoxLayout()
        min_box.setSpacing(6)
        min_box.addWidget(QLabel("最小值"))
        self.min_input = QLineEdit()
        self.min_input.setPlaceholderText("0")
        min_box.addWidget(self.min_input)
        
        max_box = QVBoxLayout()
        max_box.setSpacing(6)
        max_box.addWidget(QLabel("最大值"))
        self.max_input = QLineEdit()
        self.max_input.setPlaceholderText("255")
        max_box.addWidget(self.max_input)
        
        range_inputs.addLayout(min_box)
        range_inputs.addLayout(max_box)
        range_layout.addLayout(range_inputs)
        
        layout.addWidget(self.range_container)

        # 初始值设置（所有类型）
        init_box = QVBoxLayout()
        init_box.setSpacing(8)
        init_label = QLabel("初始值")
        init_label.setStyleSheet("font-size: 13px; color: #8E8E93; font-weight: 800; text-transform: uppercase;")
        init_box.addWidget(init_label)
        self.init_input = QLineEdit()
        self.init_input.setPlaceholderText("0")
        init_box.addWidget(self.init_input)
        layout.addLayout(init_box)

        layout.addStretch()
        
        btn_row = QHBoxLayout()
        btn_row.setSpacing(15)
        self.cancel_btn = QPushButton("取消")
        self.cancel_btn.setObjectName("cancel")
        self.cancel_btn.setFixedHeight(52)
        self.save_btn = QPushButton("确认添加")
        self.save_btn.setObjectName("save")
        self.save_btn.setFixedHeight(52)
        btn_row.addWidget(self.cancel_btn)
        btn_row.addWidget(self.save_btn)
        layout.addLayout(btn_row)

        self.cancel_btn.clicked.connect(self.reject)
        self.save_btn.clicked.connect(self.validate_and_accept)
        
        # 初始化范围显示
        self.on_type_changed(self.type_combo.currentText())

    def on_type_changed(self, type_text):
        """类型改变时更新范围输入框的显示和默认值"""
        if type_text == "string":
            self.range_container.setVisible(False)
            self.init_input.setPlaceholderText("输入文本...")
        else:
            self.range_container.setVisible(True)
            self.init_input.setPlaceholderText("0")
            # 设置默认范围值
            if type_text in self.type_configs:
                conf = self.type_configs[type_text]
                if conf[0] is not None and conf[1] is not None:
                    self.min_input.setText(str(conf[0]))
                    self.max_input.setText(str(conf[1]))

    def validate_and_accept(self):
        if not self.name_input.text().strip():
            self.name_input.setStyleSheet("border: 2px solid #FF3B30; background-color: #FFF2F2; border-radius: 12px; padding: 14px 16px;")
            return
        
        # 验证范围值（仅数值类型）
        if self.type_combo.currentText() != "string":
            try:
                min_val = float(self.min_input.text()) if self.min_input.text() else 0
                max_val = float(self.max_input.text()) if self.max_input.text() else 255
                
                if min_val >= max_val:
                    QMessageBox.warning(self, "范围错误", "最小值必须小于最大值！")
                    return
                
                # 验证初始值在范围内
                if self.init_input.text():
                    init_val = float(self.init_input.text())
                    if init_val < min_val or init_val > max_val:
                        QMessageBox.warning(self, "初始值错误", f"初始值必须在 {min_val} 到 {max_val} 之间！")
                        return
            except ValueError:
                QMessageBox.warning(self, "输入错误", "请输入有效的数值！")
                return
        
        self.accept()

    def get_data(self):
        type_text = self.type_combo.currentText()
        
        # 获取初始值
        if type_text == "string":
            init_val = self.init_input.text() if self.init_input.text() else ""
            return self.name_input.text().strip(), type_text, self.cat_combo.currentText(), None, None, init_val
        else:
            try:
                min_val = float(self.min_input.text()) if self.min_input.text() else 0
                max_val = float(self.max_input.text()) if self.max_input.text() else 255
                init_val = float(self.init_input.text()) if self.init_input.text() else 0
                return self.name_input.text().strip(), type_text, self.cat_combo.currentText(), min_val, max_val, init_val
            except:
                return self.name_input.text().strip(), type_text, self.cat_combo.currentText(), None, None, 0

class AddCategoryDialog(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("创建新分类")
        self.setFixedSize(400, 300)
        self.setWindowFlags(Qt.WindowType.Dialog | Qt.WindowType.WindowCloseButtonHint)
        self.setStyleSheet("""
            QDialog { 
                background-color: #FFFFFF; 
                border-radius: 20px;
                border: 1px solid #E5E5EA;
            }
            QLabel { 
                color: #8E8E93; 
                font-weight: 800; 
                font-size: 12px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            QLineEdit { 
                background-color: #FFFFFF; 
                border-radius: 12px; 
                padding: 14px 16px; 
                font-size: 15px; 
                border: 2px solid #E5E5EA; 
                color: #1C1C1E;
            }
            QLineEdit:focus { 
                border: 2px solid #34C759; 
            }
            QPushButton#save { 
                background-color: #34C759; 
                color: white; 
                border-radius: 16px; 
                font-weight: 800; 
                font-size: 16px; 
                border: none; 
            }
            QPushButton#cancel { 
                background-color: #F2F2F7; 
                color: #8E8E93; 
                border-radius: 16px; 
                font-weight: 800; 
                border: none; 
            }
        """)
        
        layout = QVBoxLayout(self)
        layout.setContentsMargins(30, 30, 30, 30)
        layout.setSpacing(20)
        
        layout.addWidget(QLabel("新分类名称"))
        self.name_input = QLineEdit()
        self.name_input.setPlaceholderText("例如：传感器数据 / 机器人状态")
        layout.addWidget(self.name_input)
        
        layout.addStretch()
        
        btns = QHBoxLayout()
        self.cancel_btn = QPushButton("取消")
        self.cancel_btn.setObjectName("cancel")
        self.cancel_btn.setFixedHeight(50)
        self.cancel_btn.clicked.connect(self.reject)
        
        self.save_btn = QPushButton("创建分类")
        self.save_btn.setObjectName("save")
        self.save_btn.setFixedHeight(50)
        self.save_btn.clicked.connect(self.accept)
        
        btns.addWidget(self.cancel_btn)
        btns.addWidget(self.save_btn)
        layout.addLayout(btns)
        
    def get_name(self):
        return self.name_input.text().strip()

class ModernDialog(QDialog):
    def __init__(self, title, message, mode="info", parent=None):
        super().__init__(parent)
        self.setWindowTitle(title)
        self.setFixedWidth(450)
        self.setWindowFlags(Qt.WindowType.Dialog | Qt.WindowType.WindowCloseButtonHint)
        self.setStyleSheet("""
            QDialog { 
                background-color: #FFFFFF; 
                border-radius: 20px;
                border: 1px solid #E5E5EA;
            }
            QLabel#message { 
                color: #1C1C1E; 
                font-size: 15px; 
                font-weight: 500;
                line-height: 1.4;
            }
            QLabel#title { 
                color: #8E8E93; 
                font-weight: 800; 
                font-size: 12px;
                text-transform: uppercase;
                letter-spacing: 1px;
            }
            QPushButton { 
                border-radius: 14px; 
                font-weight: 800; 
                font-size: 15px; 
                border: none; 
            }
            QPushButton#ok { 
                background-color: #007AFF; 
                color: white; 
            }
            QPushButton#ok:hover { 
                background-color: #0063CC; 
            }
            QPushButton#cancel { 
                background-color: #F2F2F7; 
                color: #8E8E93; 
            }
            QPushButton#cancel:hover { 
                background-color: #E5E5EA; 
            }
        """)
        
        layout = QVBoxLayout(self)
        layout.setContentsMargins(30, 25, 30, 25)
        layout.setSpacing(20)
        
        title_label = QLabel(title)
        title_label.setObjectName("title")
        layout.addWidget(title_label)
        
        msg_label = QLabel(message)
        msg_label.setObjectName("message")
        msg_label.setWordWrap(True)
        layout.addWidget(msg_label)
        
        layout.addSpacing(10)
        
        btns = QHBoxLayout()
        if mode == "confirm":
            self.cancel_btn = QPushButton("取 消")
            self.cancel_btn.setObjectName("cancel")
            self.cancel_btn.setFixedHeight(45)
            self.cancel_btn.clicked.connect(self.reject)
            btns.addWidget(self.cancel_btn)
            
        self.ok_btn = QPushButton("确 定")
        self.ok_btn.setObjectName("ok")
        self.ok_btn.setFixedHeight(45)
        self.ok_btn.clicked.connect(self.accept)
        btns.addWidget(self.ok_btn)
        
        layout.addLayout(btns)

    @staticmethod
    def show_message(parent, title, message):
        dialog = ModernDialog(title, message, "info", parent)
        dialog.exec()

    @staticmethod
    def confirm(parent, title, message):
        dialog = ModernDialog(title, message, "confirm", parent)
        return dialog.exec() == QDialog.DialogCode.Accepted

# --- 优化的卡片组件 ---
class ModernCard(QFrame):
    def __init__(self, title_text, color):
        super().__init__()
        self.setStyleSheet("QFrame { background-color: #FFFFFF; border-radius: 24px; border: none; }")
        shadow = QGraphicsDropShadowEffect()
        shadow.setBlurRadius(35)
        shadow.setColor(QColor(0, 0, 0, 10))
        shadow.setOffset(0, 8)
        self.setGraphicsEffect(shadow)
        
        self.setMinimumHeight(480)  # 设置固定保底高度，防止挤压
        self.layout = QVBoxLayout(self)
        self.layout.setAlignment(Qt.AlignmentFlag.AlignTop)
        self.layout.setContentsMargins(40, 24, 28, 28)
        self.layout.setSpacing(20)
        
        # 带颜色指示器的标题
        title_container = QHBoxLayout()
        title_container.setSpacing(12)
        
        color_indicator = QLabel()
        color_indicator.setFixedSize(4, 24)
        color_indicator.setStyleSheet(f"background-color: {color}; border-radius: 2px;")
        
        title = QLabel(title_text)
        title.setStyleSheet(f"font-size: 18px; font-weight: 800; color: {color}; letter-spacing: 1.5px;")
        
        title_container.addWidget(color_indicator)
        title_container.addWidget(title)
        title_container.addStretch()

        # 分类删除按钮
        self.card_del_btn = QPushButton("✕")
        self.card_del_btn.setFixedSize(28, 28)
        self.card_del_btn.setVisible(False) # 默认隐藏
        self.card_del_btn.setStyleSheet(f"""
            QPushButton {{
                background-color: #FFE5E5;
                color: #FF3B30;
                border-radius: 14px;
                font-size: 14px;
                font-weight: 900;
                border: none;
            }}
            QPushButton:hover {{
                background-color: #FF3B30;
                color: white;
            }}
        """)
        title_container.addWidget(self.card_del_btn)
        
        self.layout.addLayout(title_container)
        
        # 创建可滚动区域
        scroll_area = QScrollArea()
        scroll_area.setWidgetResizable(True)
        scroll_area.setFrameShape(QFrame.Shape.NoFrame)
        scroll_area.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        scroll_area.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAsNeeded)
        scroll_area.setStyleSheet("""
            QScrollArea {
                background-color: transparent;
                border: none;
            }
            QScrollBar:vertical {
                background-color: transparent;
                width: 8px;
                margin: 0px;
            }
            QScrollBar::handle:vertical {
                background-color: #C7C7CC;
                border-radius: 4px;
                min-height: 30px;
            }
            QScrollBar::handle:vertical:hover {
                background-color: #AEAEB2;
            }
            QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {
                height: 0px;
            }
            QScrollBar::add-page:vertical, QScrollBar::sub-page:vertical {
                background: none;
            }
        """)
        
        # 内容容器
        content_widget = QWidget()
        content_widget.setStyleSheet("background-color: transparent;")
        self.content_layout = QVBoxLayout(content_widget)
        self.content_layout.setSpacing(16)
        self.content_layout.setContentsMargins(0, 0, 8, 0)
        self.content_layout.addStretch()
        
        scroll_area.setWidget(content_widget)
        self.layout.addWidget(scroll_area)

class FullScreenRefereeSim(QWidget):
    def __init__(self, node):
        super().__init__()
        self.node = node
        self.param_controls = {}
        self.delete_mode = False
        self.QT_INT_MAX = 2147483647
        self.theme_colors = {}  # 全部由 JSON 动态生成
        self.cards = {}         # 卡片索引
        self.type_configs = {
            # 有符号整型
            "int8": (-128, 127, 0),
            "int16": (-32768, 32767, 0),
            "int32": (-2147483648, 2147483647, 0),
            "int64": (-9223372036854775808, 9223372036854775807, 0),
            # 无符号整型
            "uint8": (0, 255, 0), 
            "uint16": (0, 65535, 0), 
            "uint32": (0, 4294967295, 0), 
            "uint64": (0, 18446744073709551615, 0),
            # 浮点数
            "float32": (-1e6, 1e6, 2),
            "float64": (-1e12, 1e12, 4),
            # 字符串
            "string": (None, None, None)
        }
        self.current_topic_name = "referee_data"  # 默认话题名
        self.current_msg_package = "sentry_msgs"  # 默认消息包
        self.current_msg_type = "Referee"  # 默认消息类型
        self.msg_class = None  # 消息类
        
        # 尝试导入默认消息类型
        self.import_message_type()
        
        self.init_ui()
        self.load_all_configs()
        self.update_publisher()  # 创建发布者
        self.ros_timer = QTimer()
        self.ros_timer.timeout.connect(self.spin_ros)
        self.ros_timer.start(10)
        self.pub_timer = QTimer()
        self.pub_timer.timeout.connect(self.publish_data)

    def init_ui(self):
        self.setWindowTitle('RM Referee Dashboard Elite')
        self.setMinimumSize(1000, 700)  # 设置一个保底的最小尺寸
        self.showMaximized()
        self.setStyleSheet("background: qlineargradient(x1:0, y1:0, x2:1, y2:1, stop:0 #F5F5F7, stop:1 #E8E8EA);")
        
        outer_layout = QVBoxLayout(self)
        outer_layout.setContentsMargins(35, 28, 35, 35)
        outer_layout.setSpacing(25)
        
        # 顶部栏
        top_bar = QHBoxLayout()
        top_bar.setSpacing(20)
        
        title_label = QLabel("裁判系统仿真控制台")
        title_label.setStyleSheet("font-size: 38px; font-weight: 900; color: #1C1C1E; letter-spacing: -1px;")
        
        # 话题名称设置
        topic_container = QVBoxLayout()
        topic_container.setSpacing(5)
        topic_label = QLabel("ROS话题名称")
        topic_label.setStyleSheet("font-size: 12px; color: #8E8E93; font-weight: 600;")
        
        self.topic_input = QLineEdit()
        self.topic_input.setText("referee_data")  # 默认话题名
        self.topic_input.setFixedWidth(180)
        self.topic_input.setFixedHeight(40)
        self.topic_input.setStyleSheet("""
            QLineEdit {
                background-color: #FFFFFF;
                border: 2px solid #E5E5EA;
                border-radius: 12px;
                padding: 8px 12px;
                font-size: 14px;
                font-weight: 600;
                color: #1C1C1E;
            }
            QLineEdit:focus {
                border: 2px solid #007AFF;
            }
        """)
        # 使用editingFinished信号，只在失去焦点或按回车时触发
        self.topic_input.editingFinished.connect(self.on_topic_changed)
        
        topic_container.addWidget(topic_label)
        topic_container.addWidget(self.topic_input)
        
        # 消息类型设置
        msg_type_container = QVBoxLayout()
        msg_type_container.setSpacing(5)
        msg_type_label = QLabel("消息类型")
        msg_type_label.setStyleSheet("font-size: 12px; color: #8E8E93; font-weight: 600;")
        
        msg_type_input_layout = QHBoxLayout()
        msg_type_input_layout.setSpacing(8)
        
        self.msg_package_input = QLineEdit()
        self.msg_package_input.setText("sentry_msgs")
        self.msg_package_input.setPlaceholderText("包名(如:sentry_msgs)")
        self.msg_package_input.setFixedWidth(130)
        self.msg_package_input.setFixedHeight(40)
        self.msg_package_input.setStyleSheet("""
            QLineEdit {
                background-color: #FFFFFF;
                border: 2px solid #E5E5EA;
                border-radius: 12px;
                padding: 8px 12px;
                font-size: 13px;
                font-weight: 600;
                color: #1C1C1E;
            }
            QLineEdit:focus {
                border: 2px solid #007AFF;
            }
        """)
        
        slash_msg_label = QLabel("/ msg /")
        slash_msg_label.setFixedWidth(60)
        slash_msg_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        slash_msg_label.setStyleSheet("font-size: 14px; color: #8E8E93; font-weight: 700;")
        
        self.msg_type_input = QLineEdit()
        self.msg_type_input.setText("Referee")
        self.msg_type_input.setPlaceholderText("类型(如:String)")
        self.msg_type_input.setFixedWidth(130)
        self.msg_type_input.setFixedHeight(40)
        self.msg_type_input.setStyleSheet("""
            QLineEdit {
                background-color: #FFFFFF;
                border: 2px solid #E5E5EA;
                border-radius: 12px;
                padding: 8px 12px;
                font-size: 13px;
                font-weight: 600;
                color: #1C1C1E;
            }
            QLineEdit:focus {
                border: 2px solid #007AFF;
            }
        """)
        
        # 监听编辑完成信号（回车或失去焦点）
        self.msg_package_input.editingFinished.connect(self.on_msg_type_changed)
        self.msg_type_input.editingFinished.connect(self.on_msg_type_changed)
        
        msg_type_input_layout.addWidget(self.msg_package_input)
        msg_type_input_layout.addWidget(slash_msg_label)
        msg_type_input_layout.addWidget(self.msg_type_input)
        
        msg_type_container.addWidget(msg_type_label)
        msg_type_container.addLayout(msg_type_input_layout)

        # 组合话题和消息类型到一个布局中
        settings_hbox = QHBoxLayout()
        settings_hbox.setSpacing(40)
        settings_hbox.addLayout(msg_type_container) # 调换位置：消息类型在前
        settings_hbox.addLayout(topic_container)    # 调换位置：ROS话题在后
        settings_hbox.setAlignment(Qt.AlignmentFlag.AlignLeft)
        
        btn_base = "QPushButton { border-radius: 16px; font-weight: 800; font-size: 14px; border: none; padding: 0 15px; }"
        
        self.add_btn = QPushButton("添加变量 [+]")
        self.add_btn.setFixedHeight(52)
        self.add_btn.setMinimumWidth(120)
        self.add_btn.setStyleSheet(btn_base + """
            QPushButton { 
                background: #FFFFFF; 
                color: #007AFF; 
                border: 2px solid #E5E5EA;
            }
            QPushButton:hover { 
                background: #007AFF; 
                color: #FFFFFF; 
                border: 2px solid #007AFF;
            }
        """)
        self.add_btn.clicked.connect(self.prompt_add_global)

        self.add_cat_btn = QPushButton("添加分类 [+]")
        self.add_cat_btn.setFixedHeight(52)
        self.add_cat_btn.setMinimumWidth(130)
        self.add_cat_btn.setStyleSheet(btn_base + """
            QPushButton { 
                background: #FFFFFF; 
                color: #34C759; 
                border: 2px solid #E5E5EA;
            }
            QPushButton:hover { 
                background: #34C759; 
                color: #FFFFFF; 
                border: 2px solid #34C759;
            }
        """)
        self.add_cat_btn.clicked.connect(self.prompt_add_category)

        self.del_btn = QPushButton("删除 [-]")
        self.del_btn.setFixedHeight(52)
        self.del_btn.setMinimumWidth(100)
        self.del_btn.setCheckable(True)
        self.del_btn.setStyleSheet(btn_base + """
            QPushButton { 
                background: #FFFFFF; 
                color: #FF3B30; 
                border: 2px solid #E5E5EA;
            } 
            QPushButton:hover { 
                background: #FFE5E5; 
                border: 2px solid #FF3B30;
            }
            QPushButton:checked { 
                background: #FF3B30; 
                color: white; 
                border: 2px solid #FF3B30;
            }
        """)
        self.del_btn.clicked.connect(self.toggle_delete_mode)

        self.auto_btn = QPushButton("开启自动发布")
        self.auto_btn.setCheckable(True)
        self.auto_btn.setFixedHeight(52)
        self.auto_btn.setMinimumWidth(220)
        self.auto_btn.setStyleSheet(btn_base + """
            QPushButton { 
                background: #FFFFFF; 
                color: #007AFF; 
                border: 2px solid #E5E5EA;
            } 
            QPushButton:hover { 
                background: #E5F2FF; 
                border: 2px solid #007AFF;
            }
            QPushButton:checked { 
                background: #007AFF; 
                color: #FFFFFF; 
                border: 2px solid #007AFF;
            }
        """)
        self.auto_btn.clicked.connect(self.toggle_pub)

        self.import_btn = QPushButton("导入配置 [↓]")
        self.import_btn.setFixedHeight(52)
        self.import_btn.setMinimumWidth(120)
        self.import_btn.setStyleSheet(btn_base + """
            QPushButton { 
                background: #FFFFFF; 
                color: #34C759; 
                border: 2px solid #E5E5EA;
            }
            QPushButton:hover { 
                background: #34C759; 
                color: #FFFFFF; 
                border: 2px solid #34C759;
            }
        """)
        self.import_btn.clicked.connect(self.import_config)

        self.export_btn = QPushButton("导出配置 [↑]")
        self.export_btn.setFixedHeight(52)
        self.export_btn.setMinimumWidth(120)
        self.export_btn.setStyleSheet(btn_base + """
            QPushButton { 
                background: #FFFFFF; 
                color: #5856D6; 
                border: 2px solid #E5E5EA;
            }
            QPushButton:hover { 
                background: #5856D6; 
                color: #FFFFFF; 
                border: 2px solid #5856D6;
            }
        """)
        self.export_btn.clicked.connect(self.export_config)

        # 顶部布局重构：分为两行
        header_layout = QVBoxLayout()
        header_layout.setSpacing(20)

        # 第一行：标题和功能按钮
        top_row = QHBoxLayout()
        top_row.addWidget(title_label)
        top_row.addStretch()
        top_row.addWidget(self.import_btn)
        top_row.addWidget(self.export_btn)
        top_row.addWidget(self.add_cat_btn)
        top_row.addWidget(self.add_btn)
        top_row.addWidget(self.del_btn)
        top_row.addWidget(self.auto_btn)
        
        # 第二行：设置项（消息类型、话题）
        settings_row = QHBoxLayout()
        settings_row.addLayout(settings_hbox)
        settings_row.addStretch()

        header_layout.addLayout(top_row)
        header_layout.addLayout(settings_row)
        
        outer_layout.addLayout(header_layout)

        # 全局可滑动区域
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setStyleSheet("""
            QScrollArea { border: none; background: transparent; }
            QScrollBar:vertical {
                background: transparent;
                width: 10px;
                margin: 0px;
            }
            QScrollBar::handle:vertical {
                background: #C7C7CC;
                border-radius: 5px;
                min-height: 40px;
            }
            QScrollBar::handle:vertical:hover {
                background: #AEAEB2;
            }
            QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {
                height: 0px;
            }
        """)
        scroll_content = QWidget()
        scroll_content.setStyleSheet("background: transparent;")
        
        # 卡片网格
        self.grid = QGridLayout(scroll_content)
        self.grid.setSpacing(25)
        self.grid.setContentsMargins(0, 0, 0, 0)
        self.cards = {}
        
        for i, (cat, color) in enumerate(self.theme_colors.items()):
            card = ModernCard(cat, color)
            # 使用默认参数捕获当前 cat 值
            card.card_del_btn.clicked.connect(lambda checked, c=cat: self.remove_category(c))
            self.cards[cat] = card
            self.grid.addWidget(card, i // 2, i % 2)
        
        # 移除固定拉伸，允许滚动，并顶端对齐
        self.grid.setColumnStretch(0, 1)
        self.grid.setColumnStretch(1, 1)
        self.grid.setAlignment(Qt.AlignmentFlag.AlignTop)
        
        scroll.setWidget(scroll_content)
        outer_layout.addWidget(scroll)

    def prompt_add_global(self):
        dialog = AddParamDialog(list(self.theme_colors.keys()), list(self.type_configs.keys()), self.type_configs, self)
        if dialog.exec():
            name, type_str, cat, min_val, max_val, init_val = dialog.get_data()
            self.add_param_to_ui(name, type_str, init_val, cat, min_val, max_val)
            self.save_all_configs()

    def prompt_add_category(self):
        """弹出对话框添加新分类"""
        dialog = AddCategoryDialog(self)
        if dialog.exec():
            name = dialog.get_name()
            if name:
                self.add_new_category(name)
                self.save_all_configs()

    def add_new_category(self, category_name):
        """动态添加新的分类卡片"""
        if category_name in self.cards:
            return  # 分类卡片已存在
        
        # 如果颜色表中没有该分类，则生成新颜色
        if category_name not in self.theme_colors:
            color_palette = ["#FF3B30", "#FF9500", "#FFCC00", "#34C759", "#00C7BE", "#007AFF", "#5856D6", "#AF52DE"]
            new_color = color_palette[len(self.theme_colors) % len(color_palette)]
            self.theme_colors[category_name] = new_color
        
        current_color = self.theme_colors[category_name]
        
        # 创建新卡片
        card = ModernCard(category_name, current_color)
        card.card_del_btn.clicked.connect(lambda checked=False, c=category_name: self.remove_category(c))
        self.cards[category_name] = card
        
        # 计算新卡片的位置（保持两列布局）
        num_cards = len(self.cards)
        row = (num_cards - 1) // 2
        col = (num_cards - 1) % 2
        
        # 添加到网格布局
        self.grid.addWidget(card, row, col)
        
        print(f"新增分类卡片: {category_name}, 颜色: {current_color}, 位置: ({row}, {col})")

    def add_param_to_ui(self, name, type_text, val, category, custom_min=None, custom_max=None):
        if name in self.param_controls:
            self.remove_param(name, save=False)
        
        # 如果分类卡片不存在，创建新分类卡片
        if category not in self.cards:
            self.add_new_category(category)
        
        # 获取默认配置
        conf = self.type_configs.get(type_text, (0, 255, 0))
        
        # 如果提供了自定义范围，使用自定义范围
        if custom_min is not None and custom_max is not None:
            conf = (custom_min, custom_max, conf[2] if len(conf) > 2 else 0)
        
        theme_color = self.theme_colors.get(category, "#007AFF")
        
        # 参数容器
        wrapper = QWidget()
        w_layout = QVBoxLayout(wrapper)
        w_layout.setContentsMargins(0, 0, 0, 0)
        w_layout.setSpacing(10)
        
        # 主行：标签 + 输入框 + 删除按钮
        row = QHBoxLayout()
        row.setSpacing(18)
        row.setAlignment(Qt.AlignmentFlag.AlignVCenter)
        
        lbl = QLabel(name)
        lbl.setAlignment(Qt.AlignmentFlag.AlignVCenter)
        lbl.setStyleSheet("font-size: 16px; font-weight: 700; color: #1C1C1E; letter-spacing: 0.2px; background-color: transparent;")
        
        # 根据类型创建不同的输入控件
        if type_text == "string":
            # 字符串类型使用 QLineEdit
            input_widget = QLineEdit()
            input_widget.setText(str(val) if val else "")
            input_widget.setPlaceholderText("输入文本...")
            input_widget.setFixedHeight(52)
            input_widget.setFixedWidth(200)
            input_widget.setStyleSheet(f"""
                QLineEdit {{ 
                    background-color: #FFFFFF; 
                    border: 2px solid #E5E5EA; 
                    border-radius: 13px; 
                    font-size: 22px; 
                    font-weight: 800; 
                    color: {theme_color}; 
                    padding: 6px 14px;
                }} 
                QLineEdit:hover {{ 
                    border: 2px solid {theme_color}; 
                    background-color: #FAFAFA;
                }}
                QLineEdit:focus {{ 
                    border: 2.5px solid {theme_color}; 
                    background-color: #FFFFFF;
                }}
            """)
            
            # 为字符串输入框添加自动保存
            input_widget.textChanged.connect(lambda: self.save_all_configs())
            
            show_progress_bar = False
        else:
            # 数值类型使用 SpinBox
            # 判断是否为浮点类型或超出 QSpinBox (32位有符号整型) 范围的大数
            val_min = float(conf[0])
            val_max = float(conf[1])
            is_large_or_float = (
                type_text.startswith("float") or 
                val_min < -2147483648 or 
                val_max > 2147483647
            )
            
            if is_large_or_float:
                input_widget = QDoubleSpinBox()
                # 根据类型决定精度
                if type_text == "float64":
                    decimals = 4
                elif type_text == "float32":
                    decimals = 2
                else:
                    decimals = 0  # 大整数不保留小数
                
                input_widget.setDecimals(decimals)
                input_widget.setRange(val_min, val_max)
                input_widget.setValue(float(val))
            else:
                input_widget = QSpinBox()
                input_widget.setRange(int(val_min), int(val_max))
                input_widget.setValue(int(val))

            input_widget.setAlignment(Qt.AlignmentFlag.AlignCenter)
            input_widget.setFixedHeight(52)
            input_widget.setFixedWidth(200)
            
            # 白色背景 + 边框引导用户编辑
            input_widget.setStyleSheet(f"""
                QAbstractSpinBox {{ 
                    background-color: #FFFFFF; 
                    border: 2px solid #E5E5EA; 
                    border-radius: 13px; 
                    font-size: 22px; 
                    font-weight: 800; 
                    color: {theme_color}; 
                    padding: 6px 14px;
                }} 
                QAbstractSpinBox:hover {{ 
                    border: 2px solid {theme_color}; 
                    background-color: #FAFAFA;
                }}
                QAbstractSpinBox:focus {{ 
                    border: 2.5px solid {theme_color}; 
                    background-color: #FFFFFF;
                }}
                QAbstractSpinBox::up-button, QAbstractSpinBox::down-button {{ 
                    width: 0px; 
                }}
            """)
            
            # 为数值输入框添加自动保存
            input_widget.valueChanged.connect(lambda: self.save_all_configs())
            
            show_progress_bar = True
        
        x_btn = QPushButton("✕")
        x_btn.setFixedSize(30, 30)
        x_btn.setVisible(self.delete_mode)
        x_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        x_btn.setStyleSheet("""
            QPushButton { 
                background-color: #FF3B30; 
                color: white; 
                border-radius: 15px; 
                font-size: 16px; 
                font-weight: bold; 
                border: none; 
            } 
            QPushButton:hover { 
                background-color: #FF453A; 
            }
        """)
        x_btn.clicked.connect(lambda: self.remove_param(name, save=True))
        
        row.addWidget(lbl)
        row.addStretch()
        row.addWidget(input_widget)
        row.addWidget(x_btn)
        w_layout.addLayout(row)
        
        # 进度条（仅数值类型显示）
        bar = None
        if show_progress_bar:
            bar = QProgressBar()
            bar.setFixedHeight(5)
            bar.setTextVisible(False)
            
            # 检查范围是否超过 QProgressBar 的 int32 限制
            range_min = conf[0] if isinstance(conf[0], int) else int(conf[0])
            range_max = conf[1] if isinstance(conf[1], int) else int(conf[1])
            
            if (range_min < -2147483648 or range_max > 2147483647):
                # 超大范围，使用缩放到 0-1000
                bar.setRange(0, 1000)
                def update_bar_scaled(v):
                    ratio = (v - conf[0]) / (conf[1] - conf[0])
                    bar.setValue(int(ratio * 1000))
                input_widget.valueChanged.connect(update_bar_scaled)
                update_bar_scaled(val)
            else:
                # 正常范围
                bar.setRange(range_min, range_max)
                input_widget.valueChanged.connect(lambda v: bar.setValue(int(v)))
                bar.setValue(int(val))
            
            bar.setStyleSheet(f"""
                QProgressBar {{ 
                    background-color: #E5E5EA; 
                    border-radius: 2.5px; 
                    border: none; 
                }} 
                QProgressBar::chunk {{ 
                    background-color: {theme_color}; 
                    border-radius: 2.5px; 
                }}
            """)
            w_layout.addWidget(bar)

        if category in self.cards:
            # 插入到stretch之前
            layout = self.cards[category].content_layout
            layout.insertWidget(layout.count() - 1, wrapper)
        
        # 存储控件信息，包括配置范围
        self.param_controls[name] = (input_widget, wrapper, type_text, category, x_btn, conf)

    def toggle_delete_mode(self):
        self.delete_mode = self.del_btn.isChecked()
        # 控制参数删除按钮
        for name, info in self.param_controls.items():
            info[4].setVisible(self.delete_mode)
        # 控制分类删除按钮
        for cat, card in self.cards.items():
            card.card_del_btn.setVisible(self.delete_mode)

    def remove_category(self, category_name):
        """删除整个分类及其下所有变量"""
        if not ModernDialog.confirm(self, "确认删除", f"确定要删除核心块 '{category_name}' 及其包含的所有变量吗？"):
            return

        # 1. 删除该分类下的所有变量
        params_to_del = [n for n, info in self.param_controls.items() if info[3] == category_name]
        for n in params_to_del:
            self.remove_param(n, save=False)

        # 2. 从界面移除卡片
        if category_name in self.cards:
            card = self.cards[category_name]
            self.grid.removeWidget(card)
            card.setParent(None)
            del self.cards[category_name]

        # 3. 从颜色表中移除
        if category_name in self.theme_colors:
            del self.theme_colors[category_name]

        # 4. 重新排列剩余卡片
        self.reorganize_grid()
        
        # 5. 保存配置
        self.save_all_configs()
        
        print(f"分类 '{category_name}' 已从当前界面移除并保存到配置")

    def reorganize_grid(self):
        """重新排列网格中的卡片，填充空隙"""
        # 清除现有
        for cat, card in self.cards.items():
            self.grid.removeWidget(card)
        
        # 按顺序填坑
        for i, (cat, card) in enumerate(self.cards.items()):
            self.grid.addWidget(card, i // 2, i % 2)

    def remove_param(self, name, save=False):
        if name in self.param_controls:
            self.param_controls[name][1].setParent(None)
            del self.param_controls[name]
            if save:
                self.save_all_configs()

    def save_all_configs(self):
        """保存当前所有配置到自动保存文件"""
        data = {}
        for n, (widget, w, t, c, d, conf) in self.param_controls.items():
            if t == "string":
                value = widget.text()
            else:
                value = widget.value()
            
            # 保存基本信息
            param_info = {"type": t, "value": value, "cat": c}
            
            # 保存最大最小值（如果不是string类型）
            if t != "string" and conf[0] is not None and conf[1] is not None:
                param_info["min"] = conf[0]
                param_info["max"] = conf[1]
            
            data[n] = param_info
        
        # 收集分类颜色信息
        categories_info = {}
        for cat, color in self.theme_colors.items():
            categories_info[cat] = {"color": color}

        full_config = {
            "topic_name": self.current_topic_name,
            "msg_package": self.current_msg_package,
            "msg_type": self.current_msg_type,
            "categories": categories_info,
            "parameters": data
        }

        try:
            with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
                json.dump(full_config, f, indent=4, ensure_ascii=False)
        except Exception as e:
            print(f"自动保存失败: {e}")

    def load_all_configs(self):
        """启动时加载参数：优先加载自动保存的文件以恢复上次状态"""
        loaded_data = {}
        categories_data = {}
        topic_name = "referee_data"
        
        # 优先检查自动保存文件，不存在则回退到默认配置
        if os.path.exists(CONFIG_FILE):
            target_file = CONFIG_FILE
            print(f"加载自动保存的配置: {target_file}")
        else:
            target_file = DEFAULT_CONFIG_FILE
            print(f"自动保存文件不存在，加载默认配置: {target_file}")
        
        if os.path.exists(target_file):
            try:
                with open(target_file, 'r', encoding='utf-8') as f:
                    config = json.load(f)
                    # 仅使用 'parameters' 键名
                    loaded_data = config.get("parameters", {})
                    categories_data = config.get("categories", {})
                    topic_name = config.get("topic_name", "referee_data")
                    self.current_msg_package = config.get("msg_package", self.current_msg_package)
                    self.current_msg_type = config.get("msg_type", self.current_msg_type)
            except Exception as e:
                print(f"加载配置文件出错: {e}")
        
        # 加载分类颜色
        for cat, info in categories_data.items():
            if isinstance(info, dict) and "color" in info:
                self.theme_colors[cat] = info["color"]

        # 同步 UI
        if hasattr(self, 'msg_package_input'):
            self.msg_package_input.setText(self.current_msg_package)
        if hasattr(self, 'msg_type_input'):
            self.msg_type_input.setText(self.current_msg_type)
        self.import_message_type()
        
        # 设置话题名称
        self.current_topic_name = topic_name
        if hasattr(self, 'topic_input'):
            self.topic_input.setText(topic_name)
        
        # 先为所有定义的分类创建卡片（即使没有参数）
        for cat in categories_data.keys():
            if cat not in self.cards:
                self.add_new_category(cat)
        
        # 加载配置数据
        for name, info in loaded_data.items():
            if not isinstance(info, dict): continue
            param_cat = info.get("cat", "系统基础状态")
            min_val = info.get("min", None)
            max_val = info.get("max", None)
            self.add_param_to_ui(name, info.get("type", "uint8"), info.get("value", 0), param_cat, min_val, max_val)

    def import_config(self):
        """导入JSON配置文件"""
        file_path, _ = QFileDialog.getOpenFileName(
            self,
            "导入配置文件",
            os.path.expanduser("~"),
            "JSON文件 (*.json);;所有文件 (*)"
        )
        
        if not file_path:
            return
        
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                config = json.load(f)
            
            if not isinstance(config, dict):
                ModernDialog.show_message(self, "格式错误", "导入失败：JSON 根节点必须是字典。")
                return
            
            # --- 彻底重构排版可视化 ---
            # 1. 清空所有变量
            param_names = list(self.param_controls.keys())
            for name in param_names:
                self.remove_param(name, save=False)
            
            # 2. 清空所有分类卡片及颜色映射（核心修复：重置映射以允许重新创建卡片）
            for cat, card in list(self.cards.items()):
                self.grid.removeWidget(card)
                card.setParent(None)
            self.cards.clear()
            self.theme_colors.clear()
            
            # 3. 强制使用新格式
            # 仅从 'parameters' 获取数据
            imported_data = config.get("parameters")
            
            if imported_data is not None:
                topic_name = config.get("topic_name", self.current_topic_name)
                self.current_msg_package = config.get("msg_package", self.current_msg_package)
                self.current_msg_type = config.get("msg_type", self.current_msg_type)
                
                # 加载分类颜色
                categories_data = config.get("categories", {})
                for cat, info in categories_data.items():
                    if isinstance(info, dict) and "color" in info:
                        self.theme_colors[cat] = info["color"]
            else:
                ModernDialog.show_message(self, "格式错误", "导入失败：未找到 'parameters' 节点。")
                return

            # 同步 UI 并更新
            if topic_name:
                self.current_topic_name = topic_name
                self.topic_input.setText(topic_name)
            
            self.msg_package_input.setText(self.current_msg_package)
            self.msg_type_input.setText(self.current_msg_type)
            
            self.import_message_type()
            self.update_publisher()
            
            # 4. 先为所有定义的分类创建卡片（即使没有参数）
            for cat in categories_data.keys():
                if cat not in self.cards:
                    self.add_new_category(cat)
            
            # 5. 加载导入的参数
            for name, info in imported_data.items():
                if not isinstance(info, dict):
                    continue
                
                param_type = info.get("type", "uint8")
                param_value = info.get("value", 0)
                param_cat = info.get("cat", "系统基础状态")
                
                # 验证类型是否支持
                if param_type not in self.type_configs:
                    param_type = "uint8"
                
                # 获取最大最小值（如果有）
                min_val = info.get("min", None)
                max_val = info.get("max", None)
                
                # add_param_to_ui 会自动处理分类的重新创建
                self.add_param_to_ui(name, param_type, param_value, param_cat, min_val, max_val)
            
            # 保存到默认配置文件
            self.save_all_configs()
            
            # 显示成功消息
            ModernDialog.show_message(
                self,
                "导入成功",
                f"已从配置文件导入 {len(imported_data)} 个参数。"
            )
            
        except json.JSONDecodeError:
            ModernDialog.show_message(self, "解析失败", "JSON 格式非法，请检查文件内容。")
        except Exception as e:
            ModernDialog.show_message(self, "导入出错", f"发生未知错误：{str(e)}")

    def export_config(self):
        """导出JSON配置文件"""
        file_path, _ = QFileDialog.getSaveFileName(
            self,
            "导出配置文件",
            os.path.expanduser("~/referee_config_export.json"),
            "JSON文件 (*.json);;所有文件 (*)"
        )
        
        if not file_path:
            return
        
        # 确保文件扩展名
        if not file_path.endswith('.json'):
            file_path += '.json'
        
        try:
            # 收集当前参数配置
            data = {}
            for n, (widget, w, t, c, d, conf) in self.param_controls.items():
                if t == "string":
                    value = widget.text()
                else:
                    value = widget.value()
                
                # 保存基本信息
                param_info = {"type": t, "value": value, "cat": c}
                
                # 保存最大最小值（如果不是string类型）
                if t != "string" and conf[0] is not None and conf[1] is not None:
                    param_info["min"] = conf[0]
                    param_info["max"] = conf[1]
                
                data[n] = param_info
            
            # 收集分类颜色信息
            categories_info = {}
            for cat, color in self.theme_colors.items():
                categories_info[cat] = {"color": color}

            # 写入文件
            full_export = {
                "topic_name": self.current_topic_name,
                "msg_package": self.current_msg_package,
                "msg_type": self.current_msg_type,
                "categories": categories_info,
                "parameters": data
            }
            with open(file_path, 'w', encoding='utf-8') as f:
                json.dump(full_export, f, indent=4, ensure_ascii=False)
            
            ModernDialog.show_message(self, "导出成功", f"配置已保存至：\n{file_path}")
            
        except Exception as e:
            ModernDialog.show_message(self, "导出失败", f"导出过程中发生错误：\n{str(e)}")




    def on_topic_changed(self):
        """话题名称改变时的回调"""
        new_topic = self.topic_input.text().strip()
        
        # 验证话题名称
        if not new_topic:
            QMessageBox.warning(self, "话题名称错误", "话题名称不能为空！")
            self.topic_input.setText(self.current_topic_name)
            return
        
        # ROS话题名称规则：不能以数字开头，只能包含字母、数字、下划线、斜杠
        import re
        if not re.match(r'^[a-zA-Z_/][a-zA-Z0-9_/]*$', new_topic):
            QMessageBox.warning(
                self, 
                "话题名称错误", 
                "话题名称必须以字母、下划线或斜杠开头，\n只能包含字母、数字、下划线和斜杠！"
            )
            self.topic_input.setText(self.current_topic_name)
            return
        
        # 如果话题名称没有变化，不做任何操作
        if new_topic == self.current_topic_name:
            return
        
        self.current_topic_name = new_topic
        self.update_publisher()
        self.save_all_configs()
        print(f"话题名称已更改为: {self.current_topic_name}")

    def on_msg_type_changed(self):
        """消息类型改变时的回调 - 智能等待逻辑"""
        # 延迟100ms检查焦点，确保捕获到真实的焦点转移目标
        QTimer.singleShot(100, self._perform_msg_type_update)

    def _perform_msg_type_update(self):
        # 检查当前焦点是否还在消息类型的另外一个输入框中
        # 如果是，说明用户还在输入整个类型的过程中（如从包名Tab切换到类型名），暂不触发更新
        focused_widget = QApplication.focusWidget()
        if focused_widget in [self.msg_package_input, self.msg_type_input]:
            return

        new_package = self.msg_package_input.text().strip()
        new_type = self.msg_type_input.text().strip()
        
        # 验证输入
        if not new_package or not new_type:
            ModernDialog.show_message(self, "消息类型错误", "消息包和消息类型不能为空！")
            self.msg_package_input.setText(self.current_msg_package)
            self.msg_type_input.setText(self.current_msg_type)
            return
        
        # 如果没有变化，不做任何操作
        if new_package == self.current_msg_package and new_type == self.current_msg_type:
            return
        
        # 保存旧值以便恢复
        old_package = self.current_msg_package
        old_type = self.current_msg_type
        
        # 临时更新当前值进行尝试
        self.current_msg_package = new_package
        self.current_msg_type = new_type
        
        # 尝试导入新的消息类型
        if self.import_message_type():
            # 导入成功，更新发布者
            self.update_publisher()
            self.save_all_configs()
            print(f"成功更新消息类型至: {new_package}/msg/{new_type}")
        else:
            # 导入失败，恢复界面显示
            self.current_msg_package = old_package
            self.current_msg_type = old_type
            self.msg_package_input.setText(old_package)
            self.msg_type_input.setText(old_type)

    def import_message_type(self):
        """动态导入消息类型"""
        import importlib
        try:
            # 动态导入消息包
            module_name = f"{self.current_msg_package}.msg"
            msg_module = importlib.import_module(module_name)
            # 强制重载模块以防缓存（可选，但对于动态切换较稳妥）
            importlib.reload(msg_module)
            self.msg_class = getattr(msg_module, self.current_msg_type)
            print(f"成功导入消息类型: {module_name}.{self.current_msg_type}")
            return True
        except Exception as e:
            ModernDialog.show_message(
                self,
                "导入失败",
                f"无法识别消息类型：{self.current_msg_package}/msg/{self.current_msg_type}\n\n"
                f"错误信息：{str(e)}\n\n"
                f"支持格式：std_msgs/String, sentry_msgs/Referee 等"
            )
            print(f"导入失败: {e}")
            return False


    def update_publisher(self):
        """更新ROS发布者"""
        if not self.msg_class:
            print("错误：消息类型未导入")
            return
        
        # 销毁旧的发布者（如果存在）
        if hasattr(self.node, 'referee_pub_'):
            self.node.destroy_publisher(self.node.referee_pub_)
        
        # 创建新的发布者
        self.node.referee_pub_ = self.node.create_publisher(
            self.msg_class, 
            self.current_topic_name, 
            10
        )
        print(f"发布者已创建，话题: {self.current_topic_name}, 类型: {self.current_msg_package}.msg.{self.current_msg_type}")

    def toggle_pub(self):
        if self.auto_btn.isChecked():
            self.pub_timer.start(100)
            self.auto_btn.setText("正在发布中...")
        else:
            self.pub_timer.stop()
            self.auto_btn.setText("开启自动发布")

    def closeEvent(self, event):
        """窗口关闭时的清理操作"""
        # 停止所有定时器
        self.ros_timer.stop()
        self.pub_timer.stop()
        # 接受关闭事件
        event.accept()

    def spin_ros(self):
        try:
            rclpy.spin_once(self.node, timeout_sec=0)
        except Exception:
            # ROS2 已经 shutdown，停止定时器
            self.ros_timer.stop()
            self.pub_timer.stop()

    def publish_data(self):
        if not self.msg_class:
            return
        
        try:
            msg = self.msg_class()
            
            # 智能检查是否有 Header
            if hasattr(msg, 'header'):
                try:
                    from std_msgs.msg import Header
                    msg.header = Header()
                    msg.header.stamp = self.node.get_clock().now().to_msg()
                except Exception:
                    pass
            
            # 如果是简单类型（如 std_msgs/String），数据在 data 字段
            # 如果变量名正好叫 data，则会成功设置
            for name, (widget, _, type_text, _, _, _) in self.param_controls.items():
                if hasattr(msg, name):
                    try:
                        if type_text == "string":
                            setattr(msg, name, widget.text())
                        elif type_text.startswith("float"):
                            setattr(msg, name, float(widget.value()))
                        else:
                            setattr(msg, name, int(widget.value()))
                    except Exception:
                        continue
            
            self.node.referee_pub_.publish(msg)
        except Exception as e:
            # 避免发布过程中由于消息结构不匹配导致的频繁报错干扰
            pass

def main():
    rclpy.init()
    node = Node('referee_simulator_node')
    app = QApplication(sys.argv)
    app.setStyle("Fusion")
    gui = FullScreenRefereeSim(node)
    gui.show()
    exit_code = app.exec()
    
    # 清理 ROS2 资源
    try:
        node.destroy_node()
        rclpy.shutdown()
    except Exception:
        pass
    
    sys.exit(exit_code)

if __name__ == '__main__':
    main()
