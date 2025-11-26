import { AddressModel } from '../models/address'
import { BasketModel } from '../models/basket'
import { BasketItemModel } from '../models/basketitem'
import { CardModel } from '../models/card'
import { ChallengeModel } from '../models/challenge'
import { ComplaintModel } from '../models/complaint'
import { DeliveryModel } from '../models/delivery'
import { FeedbackModel } from '../models/feedback'
import { HintModel } from '../models/hint'
import { MemoryModel } from '../models/memory'
import { ProductModel } from '../models/product'
import { QuantityModel } from '../models/quantity'
import { RecycleModel } from '../models/recycle'
import { SecurityAnswerModel } from '../models/securityAnswer'
import { SecurityQuestionModel } from '../models/securityQuestion'
import { UserModel } from '../models/user'
import { WalletModel } from '../models/wallet'
import { type Product } from './types'
import logger from '../lib/logger'
import { getCodeChallenges } from '../lib/codingChallenges'
import type { Memory as MemoryConfig, Product as ProductConfig } from '../lib/config.types'
import config from 'config'
import * as utils from '../lib/utils'
import type { StaticUser, StaticUserAddress, StaticUserCard } from './staticData'
import { loadStaticChallengeData, loadStaticDeliveryData, loadStaticUserData, loadStaticSecurityQuestionsData } from './staticData'
import { ordersCollection, reviewsCollection } from './mongodb'
import { AllHtmlEntities as Entities } from 'html-entities'
import * as datacache from './datacache'
import * as security from '../lib/insecurity'
import replace from 'replace'

const entities = new Entities()

export default async function initializeDatabase() {
const creators = [
createSecurityQuestions,
createUsers,
createChallenges,
createRandomFakeUsers,
createProducts,
createBaskets,
createBasketItems,
createAnonymousFeedback,
createComplaints,
createRecycleItem,
createOrders,
createQuantity,
createWallet,
createDeliveryMethods,
createMemories,
prepareFilesystem
]
for (const creator of creators) await creator()
}

async function createChallenges() {
const showHints = config.get<boolean>('challenges.showHints')
const showMitigations = config.get<boolean>('challenges.showMitigations')
const challenges = await loadStaticChallengeData()
const codeChallenges = await getCodeChallenges()
const challengeKeysWithCodeChallenges = [...codeChallenges.keys()]
await Promise.all(
challenges.map(async (challengeData) => {
try {
const { name, category, description: origDescription, difficulty, hints, mitigationUrl, key, disabledEnv, tutorial, tags } = challengeData
const { enabled: isChallengeEnabled, disabledBecause } = utils.getChallengeEnablementStatus({ disabledEnv: disabledEnv?.join(';') ?? '' })
let description = origDescription.replace('juice-sh.op', config.get<string>('application.domain'))
description = description.replace(
'<iframe width="100%" height="166" scrolling="no" frameborder="no" allow="autoplay" src="[https://w.soundcloud.com/player/?url=https%3A//api.soundcloud.com/tracks/771984076&amp;color=%23ff5500&amp;auto_play=true&amp;hide_related=false&amp;show_comments=true&amp;show_user=true&amp;show_reposts=false&amp;show_teaser=true&quot;&gt;&lt;/iframe](https://w.soundcloud.com/player/?url=https%3A//api.soundcloud.com/tracks/771984076&amp;color=%23ff5500&amp;auto_play=true&amp;hide_related=false&amp;show_comments=true&amp;show_user=true&amp;show_reposts=false&amp;show_teaser=true&quot;&gt;&lt;/iframe)>',
entities.encode(config.get('challenges.xssBonusPayload'))
)
const hasCodingChallenge = challengeKeysWithCodeChallenges.includes(key)
const allTags = tags ? [...tags] : []
if (hasCodingChallenge) allTags.push('With Coding Challenge')
const createdChallenge = await ChallengeModel.create({
key,
name,
category,
tags: allTags.join(',') || undefined,
description: isChallengeEnabled ? description : `${description} <em>(This challenge is <strong>potentially harmful</strong> on ${disabledBecause}!)</em>`,
difficulty,
solved: false,
mitigationUrl: showMitigations ? mitigationUrl : null,
disabledEnv: disabledBecause,
tutorialOrder: tutorial?.order ?? null,
codingChallengeStatus: 0,
hasCodingChallenge
})
datacache.challenges[key] = createdChallenge
if (showHints && hints?.length) await createHints(createdChallenge.id, hints)
} catch (err) {
logger.error(`Could not insert Challenge ${challengeData.name}: ${utils.getErrorMessage(err)}`)
}
})
)
}

async function createHints(ChallengeId: number, hints: string[]) {
let i = 0
await Promise.all(
hints.map(async (hintText) => {
const hint = hintText.replace(/OWASP Juice Shop/, config.get<string>('application.name'))
await HintModel.create({ ChallengeId, text: hint, order: ++i, unlocked: false }).catch((err) => logger.error(`Could not create hint: ${utils.getErrorMessage(err)}`))
})
)
}

async function createUsers() {
const users = await loadStaticUserData()
await Promise.all(
users.map(async (user) => {
try {
const completeEmail = user.customDomain ? user.email : `${user.email}@${config.get<string>('application.domain')}`
const createdUser = await UserModel.create({
username: user.username,
email: completeEmail,
password: user.password,
role: user.role,
deluxeToken: user.role === security.roles.deluxe ? security.deluxeToken(completeEmail) : '',
profileImage: `assets/public/images/uploads/${user.profileImage ?? (user.role === security.roles.admin ? 'defaultAdmin.png' : 'default.svg')}`,
totpSecret: user.totpSecret,
lastLoginIp: user.lastLoginIp ?? ''
})
datacache.users[user.key] = createdUser
if (user.securityQuestion) await createSecurityAnswer(createdUser.id, user.securityQuestion.id, user.securityQuestion.answer)
if (user.feedback) await createFeedback(createdUser.id, user.feedback.comment, user.feedback.rating, createdUser.email)
if (user.deletedFlag) await deleteUser(createdUser.id)
if (user.address) await createAddresses(createdUser.id, user.address)
if (user.card) await createCards(createdUser.id, user.card)
} catch (err) {
logger.error(`Could not insert User ${user.key}: ${utils.getErrorMessage(err)}`)
}
})
)
}

async function createWallet() {
const users = await loadStaticUserData()
await Promise.all(
users.map(async (user, index) => {
await WalletModel.create({ UserId: index + 1, balance: user.walletBalance ?? 0 }).catch((err) => logger.error(`Could not create wallet: ${utils.getErrorMessage(err)}`))
})
)
}

async function createSecurityQuestions() {
const questions = await loadStaticSecurityQuestionsData()
await Promise.all(
questions.map(async (q) => await SecurityQuestionModel.create({ question: q.question }).catch((err) => logger.error(`Could not insert SecurityQuestion ${q.question}: ${utils.getErrorMessage(err)}`)))
)
}

async function createSecurityAnswer(UserId: number, SecurityQuestionId: number, answer: string) {
await SecurityAnswerModel.create({ SecurityQuestionId, UserId, answer }).catch((err) => logger.error(`Could not insert SecurityAnswer ${answer} mapped to UserId ${UserId}: ${utils.getErrorMessage(err)}`))
}

async function prepareFilesystem() {
replace({ regex: '[http://localhost:3000](http://localhost:3000)', replacement: config.get<string>('server.baseUrl'), paths: ['.well-known/csaf/provider-metadata.json'], recursive: true, silent: true })
}
