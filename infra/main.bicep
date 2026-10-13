// hookpeek infrastructure: one Static Web App (Free) + one Storage account for Table Storage.
// Deploy: az deployment group create -g <rg> -f infra/main.bicep -p adminKey=<secret> alertEmail=<you@example.com>

@description('Region for the Static Web App. The Free plan is only offered in a few regions.')
@allowed(['eastus2', 'centralus', 'westus2', 'westeurope', 'eastasia'])
param swaLocation string = 'eastus2'

@description('Region for the storage account.')
param location string = resourceGroup().location

@description('Shared secret the daily purge job sends in the x-admin-key header.')
@secure()
param adminKey string

@description('Email for the monthly budget alert. Leave empty to skip the budget.')
param alertEmail string = ''

@description('Monthly budget in USD for this resource group.')
param budgetAmount int = 5

@description('First day of the current month; used as the budget start date.')
param budgetStartDate string = utcNow('yyyy-MM-01')

var suffix = uniqueString(resourceGroup().id)

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: 'hooklog${suffix}'
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    accessTier: 'Hot'
  }
}

resource site 'Microsoft.Web/staticSites@2023-12-01' = {
  name: 'hooklog-${suffix}'
  location: swaLocation
  sku: { name: 'Free', tier: 'Free' }
  properties: {}
}

resource settings 'Microsoft.Web/staticSites/config@2023-12-01' = {
  parent: site
  name: 'appsettings'
  properties: {
    STORAGE_CONNECTION: 'DefaultEndpointsProtocol=https;AccountName=${storage.name};AccountKey=${storage.listKeys().keys[0].value};EndpointSuffix=${environment().suffixes.storage}'
    ADMIN_KEY: adminKey
  }
}

resource budget 'Microsoft.Consumption/budgets@2023-11-01' = if (!empty(alertEmail)) {
  name: 'hooklog-monthly'
  properties: {
    category: 'Cost'
    amount: budgetAmount
    timeGrain: 'Monthly'
    timePeriod: { startDate: budgetStartDate }
    notifications: {
      actual80: {
        enabled: true
        operator: 'GreaterThan'
        threshold: 80
        contactEmails: [alertEmail]
      }
      forecast100: {
        enabled: true
        operator: 'GreaterThan'
        threshold: 100
        thresholdType: 'Forecasted'
        contactEmails: [alertEmail]
      }
    }
  }
}

output staticWebAppName string = site.name
output url string = 'https://${site.properties.defaultHostname}'
output storageAccountName string = storage.name
