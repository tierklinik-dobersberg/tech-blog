---
title: "Setting up a read-only Archlinux Raspberry-Pi using Ansible"
date: 2021-11-09T19:36:49+01:00
draft: true
tags: [linux, ansible, rpi]
---

## Introduction



## Prepare the SD-Card

One of the first things we need to do is to setup the partitions on our new Mirco-SD card. Since the whole thing will be readonly afterwards I just create the bare minimum in terms of required partitions. That is, a `vfat?` formatted boot partition and a `ext4`  formatted partition that is going to hold the root filesystem.

In particular, I'm creating the following partition layout with a 400M boot and a 14.4G root partition:

    label: dos
    label-id: 0x35838234
    device: /dev/mmcblk0
    unit: sectors
    sector-size: 512
    
    /dev/mmcblk0p1 : start=        2048, size=      819200, type=c
    /dev/mmcblk0p2 : start=      821248, size=    30295040, type=83

  *The above output is from `sfdisk -d` taken after paritioning. I can recommend to backup those output as it can be reused at a later point to restore the partition table on a new card.*

You can use any partitioning tool you feel confortable with. I'm normal use plain old `fdiks` for that job. Just make sure to wipe out any existing partitions and create a new DOS MBR record (with `fdisk` that's done using the `o` key).

Once you have your desired layout in place we can start formatting the partitions and mounting them to some local folder.
I usually do stuff like this in a temporary location (speaking `tmpfs`) so I cannot forget to remove and cleanup afterwards.

    mkdir /tmp/bootstrap && cd /tmp

First, let's format and mount the boot partition. In my case it's `/dev/mmcblkp1`:

    mkfs.vfat /dev/mmcblk0p1
    mkdir boot
    mount /dev/mmcblk0p1 ./boot

Next, we do the same thing with the root partition but use `ext4`:

    mkfs.ext4 /dev/mmcblk0p2
    mkdir root
    mount /dev/mmcblk0p2 ./root

  *I normally use `btrfs` for my root system but since this is going to be read-only anyway I don't need any of btrfs' fancy features so I just go with stable `ext4`.*

Now we have both partitions formatted and mounted so we can start downloading the Archlinux ARM image for the Raspberry Pi 2B.

    curl -O ./archlinux-rpi.tar.gz http://os.archlinuxarm.org/os/ArchLinuxARM-rpi-2-latest.tar.gz

Depending on your connection this might take a few minutes so grap a cup of coffee. Once completed, unpack the image into our mounted `root` folder we created before:

    bsdtar -xpf ./archlinux-rpi.tar.gz -C ./root && sync

Next, we just need to move the boot files from the RPi image to the actual boot partition:

    mv root/boot/* boot

Done. We can `unmount root boot` and remove the SD card. It's ready to boot our RPi.

## Preparing the system

We actually want to use Ansible for configuration as much as possible but there are a few steps that we need to complete manually before we can start using it. 

So, plug in a ethernet cable, connect the Pi's 5V power supply and wait for it to finish booting. We'll use SSH to connect to the Pi so make sure to check our router to find the IP address that was leased to your Pi. In my case - running a Archlinux based router on a [APU2c4](/tags/apu/) using ISC DHCP server - a simple `journalctl -u dhcpd4 --since "5 min ago"` will quickly reveal the Pi's IP address.

So, connect to your Pi using the `alarm` user (with password `alarm`) and become root using `su` with password `root`:

    ssh alarm@<ip-of-your-pi>
    su


Now, we need to initialize the package keyring and import the package signing key of the Archlinux ARM project. Without that, we won't be able to update the system or install any other software:

    pacman-key --init
    pacman-key --populate archlinuxarm

Next, before we continue it's always a good idea to upgrade the entire system:

    pacman -Suyy

Depending on the number of updates, this will keep your Pi busy for some time. Grap another cup ;)

### Preparing for Ansible

Now that we have a fully updated Archlinux ARM running on our PI it's time to prepare for Ansible taking over configuration management. That is, we need a way to log into the Pi and becoming root, preferably without the need for a password. While in theory, Ansible allows to set the login and sudo password upon invocation I find it more confortable to don't require passwords at all (for high-security you **should** use a sudo password). Also, Ansible requires `python` (and a few python libs) to be installed.

    pacman -S sudo python python-pip python-setuptools

While you'r Pi is installing the sofware we can copy over our SSH key in another terminal:

    scp ~/.ssh/id_rsa.pub alarm@<ip-of-your-pi>:.ssh/authorized_keys

If the `.ssh` folder does not yet exist on your Pi just go ahead and create it.

Now you should be able to log into your Pi without being prompted for a password. Great! If you're not yet using public key authentication on all your systems it's really time to start!

The installation of python and sudo should have been completed at this point so let's configure `sudo` to allow executing commands as root:

    cat "alarm ALL=(ALL) NOPASSWD: ALL" >> /etc/sudoers.d/alarm

That's all, you should now be able to execute any command as `root` from your `alarm` user: `sudo ip addr` for example.

Finally, change the password of the `alarm` user to something very secure or consider removing it altogether. For the time being, I recommend to use a password so you can log into your Pi in case we screw up SSH key authentication with ansible ...

    passwd

Also, since we can run commands as root anyway there's no need to keep a password for the root account:

    sudo passwd -d root

So at this point our RPi is prepared to be configured by Ansible. Let's create a simple [inventory](https://docs.ansible.com/ansible/latest/user_guide/intro_inventory.html) file for our PI:


    cat > ./inventory <<EOT
    [all]
    doorctrl ansible_host<ip-of-your-pi> ansible_user=alarm
    EOT

To test if the inventory and password-less login works, let's execute Ansible's `ping` module:

    ansible -i inventory doorctrl -m ping -v 

## Ansible Playbook and Roles

Time to configure our Pi using Ansible. From here on, Ansible will take over the complete management and configuration of our Pi. Whenever you want to change something, update the Ansible configuration and re-play it on the Pi. If you ever 
