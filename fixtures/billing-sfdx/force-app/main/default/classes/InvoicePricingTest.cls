@IsTest
private class InvoicePricingTest {
    private static Invoice__c invoiceWithLines() {
        Account account = new Account(Name = 'Pricing', Tier__c = 'Gold');
        insert account;
        Invoice__c invoice = new Invoice__c(Account__c = account.Id, Amount__c = 0);
        insert invoice;
        insert new Invoice_Line__c(Invoice__c = invoice.Id, Quantity__c = 2, Unit_Price__c = 50);
        return [
            SELECT Id, Account__r.Tier__c, Account__r.Is_Key_Account__c,
                (SELECT Quantity__c, Unit_Price__c FROM Lines__r)
            FROM Invoice__c
            WHERE Id = :invoice.Id
        ];
    }

    @IsTest
    static void pricesTheLinesLessTheDiscount() {
        InvoicePricing pricing = new StandardPricing();
        Decimal price = pricing.price(invoiceWithLines());
        Assert.areEqual(90, price, 'Unit_Price__c times Quantity__c, less a tenth for a Gold account');
    }
}
