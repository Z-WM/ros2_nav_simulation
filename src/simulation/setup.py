from setuptools import find_packages, setup
from glob import glob
import os

package_name = 'simulation'

setup(
    name=package_name,
    version='0.0.0',
    packages=find_packages(exclude=['test']),
    data_files=[
        ('share/ament_index/resource_index/packages',
            ['resource/' + package_name]),
        ('share/' + package_name, ['package.xml']),
        (os.path.join('share', package_name, 'urdf'), glob('urdf/*.*')),
        (os.path.join('share', package_name, 'meshes'), glob('meshes/*.*')),
        (os.path.join('share', package_name, 'worlds'), glob('worlds/*.*')),
        (os.path.join('share', package_name, 'launch'), glob('launch/*.*')),
    ],
    install_requires=['setuptools'],
    zip_safe=True,
    maintainer='cube',
    maintainer_email='cube@todo.todo',
    description='TODO: Package description',
    license='TODO: License declaration',
    tests_require=['pytest'],
    entry_points={
        'console_scripts': [
        ],
    },
)
