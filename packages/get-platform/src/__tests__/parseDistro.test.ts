import { describe, expect, test } from 'vitest'

import { parseDistro } from '../getPlatform'

describe('parseDistro', () => {
  const tests = [
    {
      name: 'debian, ID',
      content: `
ID=debian
      `,
      expect: {
        targetDistro: 'debian',
        familyDistro: 'debian',
        originalDistro: 'debian',
      },
    },
    {
      name: 'debian, ID with quotes',
      content: `
ID="debian"
      `,
      expect: {
        targetDistro: 'debian',
        familyDistro: 'debian',
        originalDistro: 'debian',
      },
    },
    {
      name: 'debian, multiline',
      content: `
PRETTY_NAME="Debian GNU/Linux 10 (buster)"
NAME="Debian GNU/Linux"
VERSION_ID="10"
ID=debian
VERSION="10 (buster)"
VERSION_CODENAME=buster
      `,
      expect: {
        targetDistro: 'debian',
        familyDistro: 'debian',
        originalDistro: 'debian',
      },
    },
    {
      name: 'ubuntu, multiline',
      content: `
NAME="Ubuntu"
VERSION="18.04.3 LTS (Bionic Beaver)"
ID=ubuntu
ID_LIKE=debian
PRETTY_NAME="Ubuntu 18.04.3 LTS"
VERSION_ID="18.04"
VERSION_CODENAME=bionic
UBUNTU_CODENAME=bionic
      `,
      expect: {
        targetDistro: 'debian',
        familyDistro: 'debian',
        originalDistro: 'ubuntu',
      },
    },
    {
      name: 'alpine',
      content: `
ID=alpine
      `,
      expect: {
        targetDistro: 'musl',
        familyDistro: 'alpine',
        originalDistro: 'alpine',
      },
    },
    {
      name: 'amazon linux 1',
      content: `
NAME="Amazon Linux AMI"
VERSION="2018.03"
ID="amzn"
ID_LIKE="rhel fedora"
VERSION_ID="2018.03"
PRETTY_NAME="Amazon Linux AMI 2018.03"
ANSI_COLOR="0;33"
CPE_NAME="cpe:o:amazon:linux:2018.03:ga"
      `,
      expect: {
        targetDistro: 'rhel',
        familyDistro: 'rhel',
        originalDistro: 'amzn',
      },
    },
    {
      name: 'amazon linux 2',
      content: `
NAME="Amazon Linux"
VERSION="2"
ID="amzn"
ID_LIKE="centos rhel fedora"
VERSION_ID="2"
PRETTY_NAME="Amazon Linux 2"
ANSI_COLOR="0;33"
CPE_NAME="cpe:2.3:o:amazon:amazon_linux:2"
      `,
      expect: {
        targetDistro: 'rhel',
        familyDistro: 'rhel',
        originalDistro: 'amzn',
      },
    },
    {
      name: 'centos',
      content: `
NAME="CentOS Linux"
VERSION="8 (Core)"
ID="centos"
ID_LIKE="rhel fedora"
VERSION_ID="8"
PLATFORM_ID="platform:el8"
      `,
      expect: {
        targetDistro: 'rhel',
        familyDistro: 'rhel',
        originalDistro: 'centos',
      },
    },
    {
      name: 'fedora',
      content: `
NAME=Fedora
VERSION="31 (Container Image)"
ID=fedora
VERSION_ID=31
VERSION_CODENAME=""
PLATFORM_ID="platform:f31"
PRETTY_NAME="Fedora 31 (Container Image)"
ANSI_COLOR="0;34"
LOGO=fedora-logo-icon
      `,
      expect: {
        targetDistro: 'rhel',
        familyDistro: 'rhel',
        originalDistro: 'fedora',
      },
    },
    {
      name: 'almalinux',
      content: `
ID=almalinux
ID_LIKE="rhel centos fedora"
      `,
      expect: {
        targetDistro: 'rhel',
        familyDistro: 'rhel',
        originalDistro: 'almalinux',
      },
    },
    {
      name: 'arch',
      content: `
NAME="Arch Linux"
PRETTY_NAME="Arch Linux"
ID=arch
BUILD_ID=rolling
ANSI_COLOR="0;36"
LOGO=archlinux
      `,
      expect: {
        targetDistro: 'debian',
        familyDistro: 'arch',
        originalDistro: 'arch',
      },
    },
    {
      name: 'majaro',
      content: `
ID=manjaro
ID_LIKE=arch
      `,
      expect: {
        targetDistro: 'debian',
        familyDistro: 'arch',
        originalDistro: 'manjaro',
      },
    },
    {
      name: 'linux mint',
      content: `
NAME="Linux Mint"
VERSION="18.2 (Sonya)"
ID=linuxmint
ID_LIKE=ubuntu
PRETTY_NAME="Linux Mint 18.2"
VERSION_ID="18.2"
VERSION_CODENAME=sonya
UBUNTU_CODENAME=xenial
      `,
      expect: {
        targetDistro: 'debian',
        familyDistro: 'debian',
        originalDistro: 'linuxmint',
      },
    },
    {
      name: 'red hat',
      content: `
ID=rhel
ID_LIKE=fedora
      `,
      expect: {
        targetDistro: 'rhel',
        familyDistro: 'rhel',
        originalDistro: 'rhel',
      },
    },
    {
      name: 'opensuse tumbleweed',
      content: `
ID="opensuse-tumbleweed"
ID_LIKE="opensuse suse"
      `,
      expect: {
        targetDistro: 'rhel',
        familyDistro: 'rhel',
        originalDistro: 'opensuse-tumbleweed',
      },
    },
    {
      name: 'nixos',
      content: `
NAME=NixOS
VERSION="26.05 (Yarara)"
ID=nixos
ID_LIKE=""
PRETTY_NAME="NixOS 26.05 (Yarara)"
VERSION_ID="26.05"
VERSION_CODENAME=yarara
      `,
      expect: {
        targetDistro: 'debian',
        familyDistro: 'nixos',
        originalDistro: 'nixos',
      },
    },
    {
      name: 'unknown',
      content: `
ID="whoknows"
ID_LIKE=unknown
      `,
      expect: {
        targetDistro: undefined,
        familyDistro: undefined,
        originalDistro: 'whoknows',
      },
    },
  ]

  test.each(tests)('$name', (t) => {
    const actual = parseDistro(t.content)
    expect(actual).toMatchObject(t.expect)
  })
})
