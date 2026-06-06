from setuptools import find_packages, setup
import os
from glob import glob
import warnings
from setuptools import SetuptoolsDeprecationWarning
warnings.filterwarnings('ignore', category=SetuptoolsDeprecationWarning)

package_name = 'dynamic_message_dashboard_ros2' 

setup(
    name=package_name,
    version='1.0.0',
    packages=find_packages(exclude=['test']),
    data_files=[
        ('share/ament_index/resource_index/packages',
            ['resource/' + package_name]),
        ('share/' + package_name, ['package.xml']),
        # 安装配置文件
        (os.path.join('share', package_name, 'config'), glob('config/*.json')),
        # 安装 launch 文件
        (os.path.join('share', package_name, 'launch'), glob('launch/*.launch.py')),
    ],
    install_requires=['setuptools'],
    zip_safe=True,
    maintainer='root',
    maintainer_email='todo@todo.com',
    description='Referee System Simulator',
    license='Apache License 2.0',
    tests_require=['pytest'],
    entry_points={
        'console_scripts': [
            'dynamic_message_dashboard_ros2 = dynamic_message_dashboard_ros2.dynamic_message_dashboard_ros2:main',
        ],
    },
)