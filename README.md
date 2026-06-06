# Quick Start
```bash
sudo docker run -dit \
--name=mid360_simulation \
--privileged  \
-v /dev:/dev \
-v /home/${SUDO_USER:-$USER}:/home/${SUDO_USER:-$USER} \
-v /tmp/.X11-unix:/tmp/.X11-unix  \
-e DISPLAY=$DISPLAY \
-w /home/${SUDO_USER:-$USER} \
--net=host \
faise1/mid360_simulation:v1.0
```

# LAUNCH
```bash
source install/setup.bash
ros2 launch bringup bringup.launch.py
```
