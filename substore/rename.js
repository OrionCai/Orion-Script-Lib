/**
 * Sub-Store 节点重命名脚本
 * - 统一节点前缀为地区短码，保留旗帜与订阅后缀
 * - 清理常见冗余线路描述，例如 DIP 地区说明、IEPL 专线
 * - 基于归一化后的完整名称做精准去重
 */
function operator(proxies) {
    const globalCount = Object.create(null);
    const currentCount = Object.create(null);
    const baseNames = new Array(proxies.length);
    const suffixRegexCache = Object.create(null);

    const regionAliases = [
        ['United Arab Emirates', 'AE'],
        ['United States Los Angeles', 'US LAX'],
        ['United States San Jose', 'US SJC'],
        ['United States San Francisco', 'US SFO'],
        ['United States New York', 'US NYC'],
        ['United States Newark', 'US EWR'],
        ['United States Washington', 'US IAD'],
        ['United States Ashburn', 'US IAD'],
        ['United States Dallas', 'US DFW'],
        ['United States Chicago', 'US ORD'],
        ['United States Miami', 'US MIA'],
        ['United States Atlanta', 'US ATL'],
        ['United States Phoenix', 'US PHX'],
        ['United States Denver', 'US DEN'],
        ['United States Las Vegas', 'US LAS'],
        ['United States Portland', 'US PDX'],
        ['United States Boston', 'US BOS'],
        ['United States Seattle', 'US SEA'],
        ['Australia Sydney', 'AU SYD'],
        ['Australia Melbourne', 'AU MEL'],
        ['Australia Brisbane', 'AU BNE'],
        ['Australia Perth', 'AU PER'],
        ['Canada Toronto', 'CA TOR'],
        ['Canada Vancouver', 'CA YVR'],
        ['Canada Montreal', 'CA YUL'],
        ['Canada Calgary', 'CA YYC'],
        ['Japan Tokyo', 'JP TYO'],
        ['Japan Osaka', 'JP OSA'],
        ['Japan Nagoya', 'JP NGO'],
        ['South Korea Seoul', 'KR SEL'],
        ['Korea Seoul', 'KR SEL'],
        ['United Kingdom London', 'UK LON'],
        ['Germany Frankfurt', 'DE FRA'],
        ['Germany Berlin', 'DE BER'],
        ['Germany Munich', 'DE MUC'],
        ['France Paris', 'FR PAR'],
        ['Netherlands Amsterdam', 'NL AMS'],
        ['Switzerland Zurich', 'CH ZRH'],
        ['Sweden Stockholm', 'SE STO'],
        ['Norway Oslo', 'NO OSL'],
        ['Denmark Copenhagen', 'DK CPH'],
        ['Finland Helsinki', 'FI HEL'],
        ['Poland Warsaw', 'PL WAW'],
        ['Czech Prague', 'CZ PRG'],
        ['Austria Vienna', 'AT VIE'],
        ['Hungary Budapest', 'HU BUD'],
        ['Italy Milan', 'IT MIL'],
        ['Italy Rome', 'IT ROM'],
        ['Spain Madrid', 'ES MAD'],
        ['Spain Barcelona', 'ES BCN'],
        ['Ireland Dublin', 'IE DUB'],
        ['Portugal Lisbon', 'PT LIS'],
        ['Greece Athens', 'GR ATH'],
        ['Turkey Istanbul', 'TR IST'],
        ['Brazil Sao Paulo', 'BR SAO'],
        ['Brazil Rio de Janeiro', 'BR RIO'],
        ['Argentina Buenos Aires', 'AR BUE'],
        ['Chile Santiago', 'CL SCL'],
        ['Mexico Mexico City', 'MX MEX'],
        ['South Africa Johannesburg', 'ZA JNB'],
        ['South Africa Cape Town', 'ZA CPT'],
        ['UAE Dubai', 'AE DXB'],
        ['Russia St. Petersburg', 'RU LED'],
        ['Russia Moscow', 'RU MOW'],
        ['USA Los Angeles', 'US LAX'],
        ['USA San Jose', 'US SJC'],
        ['USA San Francisco', 'US SFO'],
        ['USA New York', 'US NYC'],
        ['USA Newark', 'US EWR'],
        ['USA Washington', 'US IAD'],
        ['USA Ashburn', 'US IAD'],
        ['USA Dallas', 'US DFW'],
        ['USA Chicago', 'US ORD'],
        ['USA Miami', 'US MIA'],
        ['USA Atlanta', 'US ATL'],
        ['USA Phoenix', 'US PHX'],
        ['USA Denver', 'US DEN'],
        ['USA Las Vegas', 'US LAS'],
        ['USA Portland', 'US PDX'],
        ['USA Boston', 'US BOS'],
        ['USA Seattle', 'US SEA'],
        ['United Kingdom', 'UK'],
        ['United States', 'US'],
        ['South Africa', 'ZA'],
        ['Saudi Arabia', 'SA'],
        ['New Zealand', 'NZ'],
        ['Hong Kong', 'HK'],
        ['Netherlands', 'NL'],
        ['Switzerland', 'CH'],
        ['Singapore', 'SG'],
        ['Indonesia', 'ID'],
        ['Philippines', 'PH'],
        ['Azerbaijan', 'AZ'],
        ['Kazakhstan', 'KZ'],
        ['Kyrgyzstan', 'KG'],
        ['Argentina', 'AR'],
        ['Australia', 'AU'],
        ['Macedonia', 'MK'],
        ['Lithuania', 'LT'],
        ['Colombia', 'CO'],
        ['Malaysia', 'MY'],
        ['Thailand', 'TH'],
        ['Vietnam', 'VN'],
        ['Romania', 'RO'],
        ['Nigeria', 'NG'],
        ['Bulgaria', 'BG'],
        ['Germany', 'DE'],
        ['Hungary', 'HU'],
        ['Austria', 'AT'],
        ['Ireland', 'IE'],
        ['Turkey', 'TR'],
        ['Taiwan', 'TW'],
        ['Canada', 'CA'],
        ['Brazil', 'BR'],
        ['Russia', 'RU'],
        ['France', 'FR'],
        ['Sweden', 'SE'],
        ['Belgium', 'BE'],
        ['Denmark', 'DK'],
        ['Iceland', 'IS'],
        ['Norway', 'NO'],
        ['Morocco', 'MA'],
        ['Mexico', 'MX'],
        ['Israel', 'IL'],
        ['Spain', 'ES'],
        ['Italy', 'IT'],
        ['Czech', 'CZ'],
        ['Egypt', 'EG'],
        ['Chile', 'CL'],
        ['India', 'IN'],
        ['Korea', 'KR'],
        ['Japan', 'JP'],
        ['Macau', 'MO'],
        ['Dubai', 'AE DXB'],
        ['Sydney', 'AU SYD'],
        ['Melbourne', 'AU MEL'],
        ['Brisbane', 'AU BNE'],
        ['Perth', 'AU PER'],
        ['Toronto', 'CA TOR'],
        ['Vancouver', 'CA YVR'],
        ['Montreal', 'CA YUL'],
        ['Calgary', 'CA YYC'],
        ['Casablanca', 'MA CMN'],
        ['Tokyo', 'JP TYO'],
        ['Osaka', 'JP OSA'],
        ['Nagoya', 'JP NGO'],
        ['Seoul', 'KR SEL'],
        ['London', 'UK LON'],
        ['Frankfurt', 'DE FRA'],
        ['Berlin', 'DE BER'],
        ['Munich', 'DE MUC'],
        ['Paris', 'FR PAR'],
        ['Amsterdam', 'NL AMS'],
        ['Zurich', 'CH ZRH'],
        ['Stockholm', 'SE STO'],
        ['Oslo', 'NO OSL'],
        ['Copenhagen', 'DK CPH'],
        ['Helsinki', 'FI HEL'],
        ['Warsaw', 'PL WAW'],
        ['Prague', 'CZ PRG'],
        ['Vienna', 'AT VIE'],
        ['Budapest', 'HU BUD'],
        ['Milan', 'IT MIL'],
        ['Rome', 'IT ROM'],
        ['Madrid', 'ES MAD'],
        ['Barcelona', 'ES BCN'],
        ['Dublin', 'IE DUB'],
        ['Lisbon', 'PT LIS'],
        ['Athens', 'GR ATH'],
        ['Istanbul', 'TR IST'],
        ['Sao Paulo', 'BR SAO'],
        ['Rio de Janeiro', 'BR RIO'],
        ['Buenos Aires', 'AR BUE'],
        ['Santiago', 'CL SCL'],
        ['Mexico City', 'MX MEX'],
        ['Johannesburg', 'ZA JNB'],
        ['Cape Town', 'ZA CPT'],
        ['USA', 'US'],

        ['Bosnia and Herzegovina', 'BA'],
        ['Trinidad and Tobago', 'TT'],
        ['Saint Vincent and the Grenadines', 'VC'],
        ['Antigua and Barbuda', 'AG'],
        ['Saint Kitts and Nevis', 'KN'],
        ['Sao Tome and Principe', 'ST'],
        ['Central African Republic', 'CF'],
        ['Democratic Republic of the Congo', 'CD'],
        ['Republic of the Congo', 'CG'],
        ['Dominican Republic', 'DO'],
        ['Papua New Guinea', 'PG'],
        ['Equatorial Guinea', 'GQ'],
        ['Cote d Ivoire', 'CI'],
        ['Cote d’Ivoire', 'CI'],
        ['Ivory Coast', 'CI'],
        ['Czech Republic', 'CZ'],
        ['North Macedonia', 'MK'],
        ['Cayman Islands', 'KY'],
        ['French Guiana', 'GF'],
        ['French Polynesia', 'PF'],
        ['New Caledonia', 'NC'],
        ['Puerto Rico', 'PR'],
        ['Virgin Islands', 'VI'],
        ['British Virgin Islands', 'VG'],
        ['Faroe Islands', 'FO'],
        ['Isle of Man', 'IM'],
        ['Greenland', 'GL'],
        ['Guam', 'GU'],
        ['Bermuda', 'BM'],
        ['Armenia', 'AM'],
        ['Albania', 'AL'],
        ['Andorra', 'AD'],
        ['Belarus', 'BY'],
        ['Croatia', 'HR'],
        ['Cyprus', 'CY'],
        ['Estonia', 'EE'],
        ['Finland', 'FI'],
        ['Greece', 'GR'],
        ['Latvia', 'LV'],
        ['Luxembourg', 'LU'],
        ['Malta', 'MT'],
        ['Moldova', 'MD'],
        ['Montenegro', 'ME'],
        ['Poland', 'PL'],
        ['Portugal', 'PT'],
        ['Serbia', 'RS'],
        ['Slovakia', 'SK'],
        ['Slovenia', 'SI'],
        ['Ukraine', 'UA'],
        ['Romania', 'RO'],
        ['UAE', 'AE'],
        ['Qatar', 'QA'],
        ['Kuwait', 'KW'],
        ['Bahrain', 'BH'],
        ['Oman', 'OM'],
        ['Jordan', 'JO'],
        ['Lebanon', 'LB'],
        ['Palestine', 'PS'],
        ['Pakistan', 'PK'],
        ['Bangladesh', 'BD'],
        ['Sri Lanka', 'LK'],
        ['Nepal', 'NP'],
        ['Maldives', 'MV'],
        ['Kazakhstan', 'KZ'],
        ['Uzbekistan', 'UZ'],
        ['Tajikistan', 'TJ'],
        ['Turkmenistan', 'TM'],
        ['Afghanistan', 'AF'],
        ['Cambodia', 'KH'],
        ['Myanmar', 'MM'],
        ['Laos', 'LA'],
        ['Brunei', 'BN'],
        ['Mongolia', 'MN'],
        ['Ethiopia', 'ET'],
        ['Kenya', 'KE'],
        ['Tanzania', 'TZ'],
        ['Uganda', 'UG'],
        ['Ghana', 'GH'],
        ['Senegal', 'SN'],
        ['Cameroon', 'CM'],
        ['Angola', 'AO'],
        ['Algeria', 'DZ'],
        ['Tunisia', 'TN'],
        ['Libya', 'LY'],
        ['Zimbabwe', 'ZW'],
        ['Zambia', 'ZM'],
        ['Botswana', 'BW'],
        ['Mauritius', 'MU'],
        ['Seychelles', 'SC'],
        ['Madagascar', 'MG'],
        ['Panama', 'PA'],
        ['Costa Rica', 'CR'],
        ['Guatemala', 'GT'],
        ['Honduras', 'HN'],
        ['El Salvador', 'SV'],
        ['Nicaragua', 'NI'],
        ['Jamaica', 'JM'],
        ['Bahamas', 'BS'],
        ['Barbados', 'BB'],
        ['Uruguay', 'UY'],
        ['Paraguay', 'PY'],
        ['Bolivia', 'BO'],
        ['Peru', 'PE'],
        ['Ecuador', 'EC'],
        ['Venezuela', 'VE'],
        ['Suriname', 'SR'],
        ['Guyana', 'GY'],

        ['美国圣何塞', 'US SJC'],
        ['美国洛杉矶', 'US LAX'],
        ['美国旧金山', 'US SFO'],
        ['美国纽约', 'US NYC'],
        ['美国纽瓦克', 'US EWR'],
        ['美国华盛顿', 'US IAD'],
        ['美国阿什本', 'US IAD'],
        ['美国达拉斯', 'US DFW'],
        ['美国芝加哥', 'US ORD'],
        ['美国迈阿密', 'US MIA'],
        ['美国亚特兰大', 'US ATL'],
        ['美国凤凰城', 'US PHX'],
        ['美国丹佛', 'US DEN'],
        ['美国拉斯维加斯', 'US LAS'],
        ['美国波特兰', 'US PDX'],
        ['美国波士顿', 'US BOS'],
        ['日本东京', 'JP TYO'],
        ['日本大阪', 'JP OSA'],
        ['日本名古屋', 'JP NGO'],
        ['韩国首尔', 'KR SEL'],
        ['英国伦敦', 'UK LON'],
        ['瑞士苏黎世', 'CH ZRH'],
        ['德国法兰克福', 'DE FRA'],
        ['德国柏林', 'DE BER'],
        ['德国慕尼黑', 'DE MUC'],
        ['法国巴黎', 'FR PAR'],
        ['荷兰阿姆斯特丹', 'NL AMS'],
        ['瑞典斯德哥尔摩', 'SE STO'],
        ['挪威奥斯陆', 'NO OSL'],
        ['丹麦哥本哈根', 'DK CPH'],
        ['芬兰赫尔辛基', 'FI HEL'],
        ['波兰华沙', 'PL WAW'],
        ['捷克布拉格', 'CZ PRG'],
        ['奥地利维也纳', 'AT VIE'],
        ['匈牙利布达佩斯', 'HU BUD'],
        ['意大利米兰', 'IT MIL'],
        ['意大利罗马', 'IT ROM'],
        ['西班牙马德里', 'ES MAD'],
        ['西班牙巴塞罗那', 'ES BCN'],
        ['爱尔兰都柏林', 'IE DUB'],
        ['葡萄牙里斯本', 'PT LIS'],
        ['希腊雅典', 'GR ATH'],
        ['土耳其伊斯坦布尔', 'TR IST'],
        ['巴西圣保罗', 'BR SAO'],
        ['巴西里约热内卢', 'BR RIO'],
        ['阿根廷布宜诺斯艾利斯', 'AR BUE'],
        ['智利圣地亚哥', 'CL SCL'],
        ['墨西哥墨西哥城', 'MX MEX'],
        ['南非约翰内斯堡', 'ZA JNB'],
        ['南非开普敦', 'ZA CPT'],
        ['印度尼西亚', 'ID'],
        ['所罗门群岛', 'SB'],
        ['波斯尼亚和黑塞哥维那', 'BA'],
        ['特立尼达和多巴哥', 'TT'],
        ['圣文森特和格林纳丁斯', 'VC'],
        ['安提瓜和巴布达', 'AG'],
        ['圣基茨和尼维斯', 'KN'],
        ['圣多美和普林西比', 'ST'],
        ['中非共和国', 'CF'],
        ['刚果民主共和国', 'CD'],
        ['刚果共和国', 'CG'],
        ['多米尼加共和国', 'DO'],
        ['巴布亚新几内亚', 'PG'],
        ['赤道几内亚', 'GQ'],
        ['沙特阿拉伯', 'SA'],
        ['捷克共和国', 'CZ'],
        ['北马其顿', 'MK'],
        ['开曼群岛', 'KY'],
        ['法属圭亚那', 'GF'],
        ['法属波利尼西亚', 'PF'],
        ['新喀里多尼亚', 'NC'],
        ['波多黎各', 'PR'],
        ['美属维尔京群岛', 'VI'],
        ['英属维尔京群岛', 'VG'],
        ['阿塞拜疆', 'AZ'],
        ['哈萨克斯坦', 'KZ'],
        ['吉尔吉斯斯坦', 'KG'],
        ['卡萨布兰卡', 'MA CMN'],
        ['澳大利亚', 'AU'],
        ['新西兰', 'NZ'],
        ['马来西亚', 'MY'],
        ['尼日利亚', 'NG'],
        ['摩尔多瓦', 'MD'],
        ['巴基斯坦', 'PK'],
        ['阿根廷', 'AR'],
        ['阿联酋', 'AE'],
        ['柬埔寨', 'KH'],
        ['东帝汶', 'TL'],
        ['梵蒂冈', 'VA'],
        ['百慕大', 'BM'],
        ['格陵兰', 'GL'],
        ['南极洲', 'AQ'],
        ['罗马尼亚', 'RO'],
        ['哥伦比亚', 'CO'],
        ['菲律宾', 'PH'],
        ['以色列', 'IL'],
        ['比利时', 'BE'],
        ['葡萄牙', 'PT'],
        ['波兰', 'PL'],
        ['希腊', 'GR'],
        ['芬兰', 'FI'],
        ['爱尔兰', 'IE'],
        ['克罗地亚', 'HR'],
        ['斯洛伐克', 'SK'],
        ['斯洛文尼亚', 'SI'],
        ['塞尔维亚', 'RS'],
        ['保加利亚', 'BG'],
        ['白俄罗斯', 'BY'],
        ['爱沙尼亚', 'EE'],
        ['拉脱维亚', 'LV'],
        ['卢森堡', 'LU'],
        ['塞浦路斯', 'CY'],
        ['马耳他', 'MT'],
        ['阿尔巴尼亚', 'AL'],
        ['黑山', 'ME'],
        ['安道尔', 'AD'],
        ['列支敦士登', 'LI'],
        ['摩纳哥', 'MC'],
        ['圣马力诺', 'SM'],
        ['直布罗陀', 'GI'],
        ['立陶宛', 'LT'],
        ['马其顿', 'MK'],
        ['俄罗斯', 'RU'],
        ['乌克兰', 'UA'],
        ['匈牙利', 'HU'],
        ['西班牙', 'ES'],
        ['土耳其', 'TR'],
        ['加拿大', 'CA'],
        ['意大利', 'IT'],
        ['奥地利', 'AT'],
        ['阿富汗', 'AF'],
        ['卡塔尔', 'QA'],
        ['索马里', 'SO'],
        ['新加坡', 'SG'],
        ['印度', 'IN'],
        ['印尼', 'ID'],
        ['日本', 'JP'],
        ['香港', 'HK'],
        ['台湾', 'TW'],
        ['美国', 'US'],
        ['韩国', 'KR'],
        ['英国', 'UK'],
        ['德国', 'DE'],
        ['荷兰', 'NL'],
        ['法国', 'FR'],
        ['巴西', 'BR'],
        ['智利', 'CL'],
        ['澳门', 'MO'],
        ['泰国', 'TH'],
        ['越南', 'VN'],
        ['瑞典', 'SE'],
        ['丹麦', 'DK'],
        ['多哥', 'TG'],
        ['埃及', 'EG'],
        ['冰岛', 'IS'],
        ['挪威', 'NO'],
        ['南非', 'ZA'],
        ['古巴', 'CU'],
        ['斐济', 'FJ'],
        ['关岛', 'GU'],
        ['缅甸', 'MM'],
        ['蒙古', 'MN'],
        ['老挝', 'LA'],
        ['捷克', 'CZ'],
        ['沙特', 'SA'],
        ['墨西哥', 'MX'],
        ['迪拜', 'AE DXB'],
        ['悉尼', 'AU SYD'],
        ['墨尔本', 'AU MEL'],
        ['布里斯班', 'AU BNE'],
        ['珀斯', 'AU PER'],
        ['多伦多', 'CA TOR'],
        ['温哥华', 'CA YVR'],
        ['蒙特利尔', 'CA YUL'],
        ['卡尔加里', 'CA YYC'],
        ['埃塞俄比亚', 'ET'],
        ['肯尼亚', 'KE'],
        ['坦桑尼亚', 'TZ'],
        ['乌干达', 'UG'],
        ['加纳', 'GH'],
        ['科特迪瓦', 'CI'],
        ['塞内加尔', 'SN'],
        ['喀麦隆', 'CM'],
        ['安哥拉', 'AO'],
        ['苏丹', 'SD'],
        ['阿尔及利亚', 'DZ'],
        ['突尼斯', 'TN'],
        ['利比亚', 'LY'],
        ['津巴布韦', 'ZW'],
        ['赞比亚', 'ZM'],
        ['博茨瓦纳', 'BW'],
        ['毛里求斯', 'MU'],
        ['塞舌尔', 'SC'],
        ['马达加斯加', 'MG'],
        ['尼泊尔', 'NP'],
        ['孟加拉国', 'BD'],
        ['斯里兰卡', 'LK'],
        ['哈萨克斯坦', 'KZ'],
        ['乌兹别克斯坦', 'UZ'],
        ['塔吉克斯坦', 'TJ'],
        ['土库曼斯坦', 'TM'],
        ['伊朗', 'IR'],
        ['伊拉克', 'IQ'],
        ['约旦', 'JO'],
        ['黎巴嫩', 'LB'],
        ['巴勒斯坦', 'PS'],
        ['科威特', 'KW'],
        ['巴林', 'BH'],
        ['阿曼', 'OM'],
        ['也门', 'YE'],
        ['叙利亚', 'SY'],
        ['卡塔尔', 'QA'],
        ['马尔代夫', 'MV'],
        ['文莱', 'BN'],
        ['新喀里多尼亚', 'NC'],
        ['巴拿马', 'PA'],
        ['哥斯达黎加', 'CR'],
        ['危地马拉', 'GT'],
        ['洪都拉斯', 'HN'],
        ['萨尔瓦多', 'SV'],
        ['尼加拉瓜', 'NI'],
        ['牙买加', 'JM'],
        ['海地', 'HT'],
        ['巴哈马', 'BS'],
        ['巴巴多斯', 'BB'],
        ['乌拉圭', 'UY'],
        ['巴拉圭', 'PY'],
        ['玻利维亚', 'BO'],
        ['秘鲁', 'PE'],
        ['厄瓜多尔', 'EC'],
        ['委内瑞拉', 'VE'],
        ['苏里南', 'SR'],
        ['圭亚那', 'GY']
    ];

    const sortedRegionAliases = regionAliases
        .map(([alias, replacement]) => [alias, replacement, alias.toLowerCase()])
        .sort((firstAlias, secondAlias) => secondAlias[0].length - firstAlias[0].length);

    const flagCodeOverrides = {
        '🇬🇧': 'UK',
        '🇼🇸': 'TW'
    };

    const knownRegionCodes = new Set(
        regionAliases.map(([, replacement]) => replacement.split(/\s+/)[0])
    );
    Object.values(flagCodeOverrides).forEach(code => knownRegionCodes.add(code));

    const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const leadingFlagRegex = /^([\u{1F1E6}-\u{1F1FF}]{2}|🏴‍☠️)\s*/u;
    const inlineFlagRegex = /^(.{1,24}?)([\u{1F1E6}-\u{1F1FF}]{2}|🏴‍☠️)\s*(.*)$/u;

    const flagToRegionCode = flag => {
        if (!flag) return '';
        if (flagCodeOverrides[flag]) return flagCodeOverrides[flag];

        const codePoints = [...flag].map(char => char.codePointAt(0));
        if (
            codePoints.length !== 2 ||
            codePoints.some(codePoint => codePoint < 0x1F1E6 || codePoint > 0x1F1FF)
        ) {
            return '';
        }

        return codePoints
            .map(codePoint => String.fromCharCode(codePoint - 0x1F1E6 + 65))
            .join('');
    };

    const stripExistingSuffix = (name, subName) => {
        if (!subName) return name.trim();
        const suffixRegex = suffixRegexCache[subName] || (
            suffixRegexCache[subName] = new RegExp(`\\s+-\\s*${escapeRegex(subName)}(?:\\s+\\d{2})?\\s*$`, 'i')
        );
        return name.replace(suffixRegex, '').trim();
    };

    const joinAlias = (replacement, rest) => {
        const cleanRest = rest.trim();
        if (!cleanRest) return replacement;
        if (/^[|/\-]/.test(cleanRest)) {
            return `${replacement}${cleanRest}`;
        }
        return `${replacement} ${cleanRest}`;
    };

    const normalizeLeadingRegion = name => {
        const cleanName = name.trim();
        const cleanNameLower = cleanName.toLowerCase();

        for (const [alias, replacement, aliasLower] of sortedRegionAliases) {
            if (!cleanNameLower.startsWith(aliasLower)) continue;

            const rest = cleanName.slice(alias.length);
            if (/^[A-Za-z]/.test(alias) && rest && !/^[\s\d[|\-.x]/i.test(rest)) {
                continue;
            }

            return joinAlias(replacement, rest);
        }

        return cleanName;
    };

    const leadingCodeOf = name => {
        const match = name.match(/^([A-Z]{2})(?=\b|\s|-|$|\d)/);
        return match ? match[1] : '';
    };

    const hasKnownRegionCode = name => {
        const leadingCode = leadingCodeOf(name);
        if (knownRegionCodes.has(leadingCode)) return true;

        const proMatch = name.match(/^Pro-\s*(.+)$/i);
        return proMatch ? knownRegionCodes.has(leadingCodeOf(proMatch[1])) : false;
    };

    const hasSpecificRegionCode = (name, regionCode) => {
        if (!regionCode) return false;
        if (leadingCodeOf(name) === regionCode) return true;

        const proMatch = name.match(/^Pro-\s*(.+)$/i);
        return proMatch ? leadingCodeOf(proMatch[1]) === regionCode : false;
    };

    const moveProRegionToFront = (name, regionCode) => {
        if (!regionCode) return name;

        const proRegionMatch = name.match(/^Pro-\s*([A-Z]{2})(.*)$/i);
        if (!proRegionMatch || proRegionMatch[1].toUpperCase() !== regionCode) return name;

        const rest = proRegionMatch[2].trim();
        return rest ? `${regionCode} Pro-${rest}` : regionCode;
    };

    const simplifyCoreName = name => {
        return name
            .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\uFE0F]/gu, '')
            .replace(/\u200d/g, '')
            .replace(/\s*\|\s*流媒体/gi, '')
            .replace(/-\s*(\d+(?:\.\d+)?)倍/gi, ' $1x')
            .replace(/(\d+(?:\.\d+)?)倍/gi, '$1x')
            .replace(/\b(\d+(?:\.\d+)?)X\b/g, '$1x')
            .replace(/([A-Z]{2})\s*(专属|家宽|AI|高速|专线)(\d+)/g, '$1 $2 $3')
            .replace(/\b(AI)(\d+)/g, '$1 $2')
            .replace(/\b(Pro-)\s+/gi, '$1')
            .replace(/^((?:Pro-\s*)?)([A-Z]{2})(?=[\u4e00-\u9fff]|\d)/u, '$1$2 ')
            .replace(/\s+\[/g, ' [')
            .replace(/\s{2,}/g, ' ')
            .trim();
    };

    const normalizeBilingualName = name => {
        const bilingualMatch = name.match(/^(.+?)\s*｜\s*(.+)$/);
        if (!bilingualMatch) return name;

        const leftName = normalizeLeadingRegion(bilingualMatch[1]);
        const rightName = normalizeLeadingRegion(bilingualMatch[2]);
        const leftCode = leadingCodeOf(leftName);
        const rightCode = leadingCodeOf(rightName);

        if (leftCode && rightCode && leftCode === rightCode) {
            return rightName === rightCode ? leftName : rightName;
        }
        if (rightCode) return rightName;
        if (leftCode) return leftName;

        return name.replace(/\s*｜\s*/g, ' ');
    };

    const normalizeCoreName = name => {
        const leadingFlagMatch = name.match(leadingFlagRegex);
        const inlineFlagMatch = leadingFlagMatch
            ? null
            : name.match(inlineFlagRegex);
        const flag = leadingFlagMatch ? leadingFlagMatch[1] : inlineFlagMatch ? inlineFlagMatch[2] : '';
        let core = name.trim();

        if (leadingFlagMatch) {
            core = name.slice(leadingFlagMatch[0].length).trim();
        } else if (inlineFlagMatch) {
            const prefix = inlineFlagMatch[1].trim();
            const rest = inlineFlagMatch[3].trim();
            core = rest ? `${prefix}${prefix.endsWith('-') ? '' : ' '}${rest}` : prefix;
        }

        core = core
            .replace(/\[DIP[^\]]*\]/gi, '[DIP]');

        core = normalizeBilingualName(core);
        core = normalizeLeadingRegion(core);

        if (/^Pro-\s*/i.test(core)) {
            core = core.replace(/^(Pro-\s*)(.+)$/i, (fullMatch, proPrefix, restName) => {
                return `${proPrefix}${normalizeLeadingRegion(restName)}`;
            });
        }

        core = core
            .replace(/^([A-Z]{2})\s*(实验性|标准|高级)\s+IEPL\s+专线\s*(\d+)(.*)$/i, '$1 $2 $3$4')
            .replace(/搬瓦工荷兰/g, '搬瓦工')
            .replace(/\s{2,}/g, ' ')
            .trim();

        const flagRegionCode = flagToRegionCode(flag);
        core = moveProRegionToFront(core, flagRegionCode);

        if (
            flagRegionCode &&
            !hasSpecificRegionCode(core, flagRegionCode) &&
            !hasKnownRegionCode(core)
        ) {
            core = joinAlias(flagRegionCode, core);
        }

        core = simplifyCoreName(core);

        return flag ? `${flag} ${core}` : core;
    };

    proxies.forEach((proxy, proxyIndex) => {
        const proxyName = typeof proxy.name === 'string' ? proxy.name : '';
        const subName = typeof proxy._subName === 'string' ? proxy._subName.trim() : '';
        const coreName = stripExistingSuffix(proxyName, subName);
        const normalizedCoreName = normalizeCoreName(coreName);
        const baseName = subName ? `${normalizedCoreName} - ${subName}` : normalizedCoreName;

        baseNames[proxyIndex] = baseName;
        globalCount[baseName] = (globalCount[baseName] || 0) + 1;
    });

    return proxies.map((proxy, proxyIndex) => {
        const baseName = baseNames[proxyIndex];

        if (globalCount[baseName] > 1) {
            currentCount[baseName] = (currentCount[baseName] || 0) + 1;
            proxy.name = `${baseName} ${currentCount[baseName].toString().padStart(2, '0')}`;
        } else {
            proxy.name = baseName;
        }

        return proxy;
    });
}