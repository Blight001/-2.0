module.exports = {
    _getCharsetGroup(type) {
        switch (type) {
            case 'lowercase':
                return 'abcdefghijklmnopqrstuvwxyz';
            case 'uppercase':
                return 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
            case 'numbers':
                return '0123456789';
            case 'special':
                return '!@#$%^&*';
            default:
                return '';
        }
    },

    _getRandomCharFromCharset(charset) {
        if (!charset) {
            return '';
        }

        return charset.charAt(Math.floor(Math.random() * charset.length));
    },

    _shuffleCharacters(characters) {
        const result = Array.isArray(characters) ? characters.slice() : String(characters || '').split('');
        for (let i = result.length - 1; i > 0; i -= 1) {
            const j = Math.floor(Math.random() * (i + 1));
            [result[i], result[j]] = [result[j], result[i]];
        }
        return result;
    },

    _generatePasswordFromGroups(length, groupTypes) {
        const groups = Array.isArray(groupTypes)
            ? groupTypes.map(type => this._getCharsetGroup(type)).filter(Boolean)
            : [];
        const combinedCharset = Array.from(new Set(groups.join('').split(''))).join('');
        const safeLength = Math.max(parseInt(length, 10) || 0, groups.length || 1);

        const characters = groups.map(charset => this._getRandomCharFromCharset(charset));
        while (characters.length < safeLength) {
            characters.push(this._getRandomCharFromCharset(combinedCharset));
        }

        return this._shuffleCharacters(characters).join('');
    },

    _getCardKeyPrefix() {
        const rawPrefix = typeof this.cardKeyPrefix === 'string' ? this.cardKeyPrefix : '';
        return rawPrefix.trim().slice(0, 4);
    },

    _getEmailSuffix() {
        const rawSuffix = typeof this.emailSuffix === 'string' && this.emailSuffix.trim()
            ? this.emailSuffix.trim()
            : String(this.app?.getEmailSuffix?.() || this.app?.emailAddressSuffix || '').trim();
        return rawSuffix.replace(/^@+/, '').replace(/@+$/, '').trim();
    },

    _applyCardKeyPrefixToEmail(email) {
        if (this.applyCardKeyPrefix === false) {
            return typeof email === 'string' ? email.trim() : '';
        }

        const rawEmail = typeof email === 'string' ? email.trim() : '';
        const prefix = this._getCardKeyPrefix();
        if (!rawEmail || !prefix) {
            return rawEmail;
        }

        if (rawEmail.startsWith(prefix)) {
            return rawEmail;
        }

        return `${prefix}${rawEmail}`;
    },

    _applyCardKeyPrefixToCredentials() {
        if (!this.rawEmail) {
            this.rawEmail = this.credentials?.email || this.generatedEmail || '';
        }

        const prefixedEmail = this._applyCardKeyPrefixToEmail(this.credentials?.email || this.generatedEmail || '');
        if (prefixedEmail) {
            this.credentials.email = prefixedEmail;
            this.generatedEmail = prefixedEmail;
        }
        return prefixedEmail;
    },

    _applyEmailSuffixToEmail(email) {
        const rawEmail = typeof email === 'string' ? email.trim() : '';
        if (!rawEmail) {
            return '';
        }

        const suffix = this._getEmailSuffix();
        if (!suffix) {
            return rawEmail;
        }

        const normalizedEmail = rawEmail.startsWith('@') ? rawEmail.substring(1) : rawEmail;
        if (normalizedEmail.includes('@')) {
            return normalizedEmail;
        }

        return `${normalizedEmail}@${suffix}`;
    },

    _applyEmailSuffixToCredentials() {
        if (!this.rawEmail) {
            this.rawEmail = this.credentials?.email || this.generatedEmail || '';
        }

        const emailWithSuffix = this._applyEmailSuffixToEmail(this.credentials?.email || this.generatedEmail || '');
        if (emailWithSuffix) {
            this.credentials.email = emailWithSuffix;
            this.generatedEmail = emailWithSuffix;
        }

        return emailWithSuffix;
    },

    _initializeRandomCredentials() {
        try {
            if (!this.credentials.email) {
                const steps = this.cardConfig.steps || [];
                const emailStep = steps.find(s =>
                    s.type === 'type' &&
                    (s.name && (s.name.toLowerCase().includes('email') || s.name.includes('邮箱')))
                );

                if (emailStep && emailStep.text) {
                    this.logger.info(`从步骤中找到邮箱模板: ${emailStep.text}`);
                    this.credentials.email = emailStep.text;
                }
            }

            if (!this.credentials.password) {
                const steps = this.cardConfig.steps || [];
                const passwordStep = steps.find(s =>
                    s.type === 'type' &&
                    (s.name && (s.name.toLowerCase().includes('password') || s.name.includes('密码')))
                );

                if (passwordStep && passwordStep.text) {
                    this.logger.info(`从步骤中找到密码模板: ${passwordStep.text}`);
                    this.credentials.password = passwordStep.text;
                }
            }

            if ((this.credentials.email || '').match(/{random}|{account}/)) {
                const emailConfig = this.emailRandomConfig?.email || { length: 8, type: 'lowercase' };
                const randomPart = this._generateRandomStringByConfig(emailConfig);
                this.generatedAccount = randomPart;

                const emailTemplate = this.credentials.email;
                const generated = emailTemplate.replace(/{random}|{account}/g, randomPart);

                this.generatedEmail = generated;
                this.credentials.email = generated;
                this.logger.info(`任务启动时预生成随机邮箱: ${generated} (account: ${randomPart})`);
            }

            const passwordValue = this.credentials.password || '';
            if (passwordValue.includes('{random}') || passwordValue === '{password}') {
                const passwordConfig = this.randomConfig.password || { length: 12, type: 'mixed' };
                const randomPassword = this._generateRandomStringByConfig(passwordConfig);

                if (passwordValue === '{password}') {
                    this.credentials.password = randomPassword;
                } else {
                    const passwordTemplate = this.credentials.password;
                    const generatedPassword = passwordTemplate.replace('{random}', randomPassword);
                    this.credentials.password = generatedPassword;
                }
                this.generatedPassword = this.credentials.password;
                this.logger.info(`任务启动时预生成随机密码: ${this.credentials.password}`);
            }

            const prefixedEmail = this._applyCardKeyPrefixToCredentials();
            if (prefixedEmail) {
                this.logger.info(`任务启动时应用卡密前缀邮箱: ${prefixedEmail}`);
            }

            const emailWithSuffix = this._applyEmailSuffixToCredentials();
            if (emailWithSuffix && emailWithSuffix !== prefixedEmail) {
                this.logger.info(`任务启动时应用邮箱后缀: ${emailWithSuffix}`);
            }
        } catch (error) {
            this.logger.debug(`预生成随机凭据失败: ${error.message}`);
        }
    },

    _generateRandomStringByConfig(config) {
        const length = config.length || 8;
        const type = config.type || 'alphanumeric';
        let charset = '';

        switch (type) {
            case 'lowercase':
                charset = 'abcdefghijklmnopqrstuvwxyz';
                break;
            case 'uppercase':
                charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
                break;
            case 'letters':
                charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
                break;
            case 'numbers':
                charset = '0123456789';
                break;
            case 'mixed':
            case 'alphanumeric':
                charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
                break;
            case 'lowercase_uppercase_numbers':
                return this._generatePasswordFromGroups(length, ['lowercase', 'uppercase', 'numbers']);
            case 'lowercase_uppercase_special':
                return this._generatePasswordFromGroups(length, ['lowercase', 'uppercase', 'special']);
            case 'lowercase_numbers_special':
                return this._generatePasswordFromGroups(length, ['lowercase', 'numbers', 'special']);
            case 'uppercase_numbers_special':
                return this._generatePasswordFromGroups(length, ['uppercase', 'numbers', 'special']);
            case 'strong':
                return this._generatePasswordFromGroups(length, ['lowercase', 'uppercase', 'numbers', 'special']);
            case 'custom':
                charset = config.charset || 'abcdefghijklmnopqrstuvwxyz0123456789';
                break;
            default:
                charset = 'abcdefghijklmnopqrstuvwxyz0123456789';
        }

        let result = '';
        for (let i = 0; i < length; i++) {
            result += charset.charAt(Math.floor(Math.random() * charset.length));
        }
        return result;
    },

    _generateRandomString(length) {
        return this._generateRandomStringByConfig({ length, type: 'alphanumeric' });
    },

    _generateRandomPassword(length) {
        return this._generateRandomStringByConfig({ length, type: 'mixed' });
    }
};
