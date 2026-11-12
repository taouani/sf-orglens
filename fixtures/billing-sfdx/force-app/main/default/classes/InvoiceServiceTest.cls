@IsTest
private class InvoiceServiceTest {
    @TestSetup
    static void setup() {
        Account account = new Account(Name = 'Acme', Tier__c = 'Gold', Credit_Limit__c = 5000);
        insert account;
        insert new Invoice__c(Account__c = account.Id, Amount__c = 100, Status__c = 'Sent');
    }

    @IsTest
    static void marksAnInvoiceAsPaid() {
        Invoice__c invoice = [SELECT Id FROM Invoice__c LIMIT 1];
        Id invoiceId = invoice.Id;
        Test.startTest();
        InvoiceService.markPaid(invoiceId);
        Test.stopTest();
        invoice = [SELECT Status__c, Paid_Date__c FROM Invoice__c WHERE Id = :invoiceId];
        System.assertEquals('Paid', invoice.Status__c);
        System.assertNotEquals(null, invoice.Paid_Date__c);
    }
}
